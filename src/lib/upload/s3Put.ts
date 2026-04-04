"use client";

export type UploadStatus =
  | "queued"
  | "presigning"
  | "uploading"
  | "completing"
  | "success"
  | "error"
  | "canceled";

export type UploadItem = {
  error?: string;
  etag?: string;
  file: File;
  fileId?: string;
  localId: string;
  progress: number;
  status: UploadStatus;
};

export type UploadedFileResult = {
  etag: string;
  fileId: string;
  filename: string;
};

type PresignResponse = {
  error?: {
    code: string;
    message: string;
  };
  fileId: string;
  headers?: Record<string, string>;
  uploadUrl: string;
};

type CompleteResponse = {
  error?: {
    code: string;
    message: string;
  };
  retryable?: boolean;
};

type FetchLike = typeof fetch;

type XhrLike = Pick<
  XMLHttpRequest,
  | "abort"
  | "getResponseHeader"
  | "open"
  | "readyState"
  | "responseText"
  | "send"
  | "setRequestHeader"
  | "status"
  | "upload"
  | "onabort"
  | "onerror"
  | "onload"
> & {
  upload: {
    onprogress: ((event: ProgressEvent<EventTarget>) => void) | null;
  };
};

type UploadCallbacks = {
  onBatchComplete?: (completed: UploadedFileResult[]) => void;
  onItemUpdate?: (item: UploadItem) => void;
};

type UploadRuntime = UploadCallbacks & {
  fetchImpl?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  xhrFactory?: () => XhrLike;
};

type ActiveTask = {
  abort: () => void;
  localId: string;
};

export type UploadController = {
  cancel: (localId: string) => void;
  promise: Promise<UploadedFileResult[]>;
};

const DEFAULT_RETRY_DELAY_MS = 350;

function createLocalId(file: File, index: number) {
  return `${index}-${file.name}-${file.lastModified}-${file.size}`;
}

function createSnapshot(file: File, index: number): UploadItem {
  return {
    file,
    localId: createLocalId(file, index),
    progress: 0,
    status: "queued",
  };
}

function toErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return fallback;
}

function normalizeEtag(etag: string) {
  return etag.trim().replace(/^"+|"+$/g, "");
}

async function parseJsonSafe<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

async function presignFile(
  file: File,
  fetchImpl: FetchLike,
  signal: AbortSignal
): Promise<PresignResponse> {
  const response = await fetchImpl("/api/upload/presign", {
    body: JSON.stringify({
      contentType: file.type || "application/pdf",
      filename: file.name,
      sizeBytes: file.size,
    }),
    headers: {
      "content-type": "application/json",
    },
    method: "POST",
    signal,
  });

  const payload = await parseJsonSafe<PresignResponse>(response);

  if (!response.ok || !payload?.fileId || !payload.uploadUrl) {
    throw new Error(
      payload?.error?.message ||
        payload?.error?.code ||
        "Unable to create upload URL"
    );
  }

  return {
    fileId: payload.fileId,
    headers: payload.headers,
    uploadUrl: payload.uploadUrl,
  };
}

function putObjectWithProgress(
  file: File,
  presigned: PresignResponse,
  xhrFactory: () => XhrLike,
  signal: AbortSignal,
  onProgress: (progress: number) => void
): Promise<{ etag: string }> {
  return new Promise((resolve, reject) => {
    const xhr = xhrFactory();

    const abortUpload = () => {
      xhr.abort();
    };

    if (signal.aborted) {
      abortUpload();
      reject(new DOMException("Upload canceled", "AbortError"));
      return;
    }

    signal.addEventListener("abort", abortUpload, { once: true });

    xhr.open("PUT", presigned.uploadUrl);

    Object.entries(presigned.headers ?? {}).forEach(([key, value]) => {
      xhr.setRequestHeader(key, value);
    });

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) {
        return;
      }

      onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
    };

    xhr.onerror = () => {
      signal.removeEventListener("abort", abortUpload);
      reject(new Error("Upload failed"));
    };

    xhr.onabort = () => {
      signal.removeEventListener("abort", abortUpload);
      reject(new DOMException("Upload canceled", "AbortError"));
    };

    xhr.onload = () => {
      signal.removeEventListener("abort", abortUpload);

      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error("Upload failed"));
        return;
      }

      const etag = normalizeEtag(xhr.getResponseHeader("etag") || "");

      if (!etag) {
        reject(new Error("Upload completed without an etag"));
        return;
      }

      onProgress(100);
      resolve({ etag });
    };

    xhr.send(file);
  });
}

async function completeUpload(
  fileId: string,
  etag: string,
  fetchImpl: FetchLike,
  signal: AbortSignal
) {
  const response = await fetchImpl("/api/upload/complete", {
    body: JSON.stringify({
      etag: normalizeEtag(etag),
      fileId,
    }),
    headers: {
      "content-type": "application/json",
    },
    method: "POST",
    signal,
  });

  const payload = await parseJsonSafe<CompleteResponse>(response);

  if (!response.ok) {
    const message =
      payload?.error?.message ||
      payload?.error?.code ||
      "Unable to verify upload";
    const error = new Error(message) as Error & { retryable?: boolean };
    error.retryable = Boolean(payload?.retryable);
    throw error;
  }
}

async function completeWithRetry(
  fileId: string,
  etag: string,
  fetchImpl: FetchLike,
  signal: AbortSignal,
  sleep: (ms: number) => Promise<void>
) {
  try {
    await completeUpload(fileId, etag, fetchImpl, signal);
  } catch (error) {
    const retryable =
      typeof error === "object" &&
      error !== null &&
      "retryable" in error &&
      Boolean(error.retryable);

    if (!retryable || signal.aborted) {
      throw error;
    }

    await sleep(DEFAULT_RETRY_DELAY_MS);

    if (signal.aborted) {
      throw new DOMException("Upload canceled", "AbortError");
    }

    await completeUpload(fileId, etag, fetchImpl, signal);
  }
}

export function startPresignedUploads(
  files: File[],
  runtime: UploadRuntime = {}
): UploadController {
  const fetchImpl = runtime.fetchImpl ?? fetch;
  const xhrFactory = runtime.xhrFactory ?? (() => new XMLHttpRequest());
  const sleep =
    runtime.sleep ??
    ((ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms)));
  const activeTask: { current: ActiveTask | null } = { current: null };
  const canceledIds = new Set<string>();
  const items = files.map(createSnapshot);

  const emit = (item: UploadItem) => {
    runtime.onItemUpdate?.({ ...item });
  };

  items.forEach(emit);

  const promise = (async () => {
    const completed: UploadedFileResult[] = [];

    for (const item of items) {
      if (canceledIds.has(item.localId)) {
        item.status = "canceled";
        emit(item);
        continue;
      }

      const controller = new AbortController();
      activeTask.current = {
        abort: () => controller.abort(),
        localId: item.localId,
      };

      try {
        item.status = "presigning";
        item.error = undefined;
        emit(item);

        const presigned = await presignFile(item.file, fetchImpl, controller.signal);

        item.fileId = presigned.fileId;

        if (canceledIds.has(item.localId) || controller.signal.aborted) {
          throw new DOMException("Upload canceled", "AbortError");
        }

        item.status = "uploading";
        item.progress = 0;
        emit(item);

        const uploaded = await putObjectWithProgress(
          item.file,
          presigned,
          xhrFactory,
          controller.signal,
          (progress) => {
            item.progress = progress;
            emit(item);
          }
        );

        item.etag = uploaded.etag;
        item.status = "completing";
        item.progress = 100;
        emit(item);

        await completeWithRetry(
          presigned.fileId,
          uploaded.etag,
          fetchImpl,
          controller.signal,
          sleep
        );

        item.status = "success";
        emit(item);

        completed.push({
          etag: uploaded.etag,
          fileId: presigned.fileId,
          filename: item.file.name,
        });
      } catch (error) {
        if (
          error instanceof DOMException &&
          error.name === "AbortError"
        ) {
          item.status = "canceled";
          item.error = undefined;
          emit(item);
          continue;
        }

        item.status = "error";
        item.error = toErrorMessage(error, "Upload failed");
        emit(item);
      } finally {
        if (activeTask.current?.localId === item.localId) {
          activeTask.current = null;
        }
      }
    }

    runtime.onBatchComplete?.(completed);
    return completed;
  })();

  return {
    cancel(localId) {
      canceledIds.add(localId);

      if (activeTask.current?.localId === localId) {
        activeTask.current.abort();
      }
    },
    promise,
  };
}
