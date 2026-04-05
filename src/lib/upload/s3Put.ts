"use client";

import {
  ApiClientError,
  requestJson,
  type CompleteUploadResponse,
  type PresignUploadResponse,
} from "@/lib/api/client";

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
  objectKey: string;
};

type PresignResponse = {
  fileId: string;
  headers?: Record<string, string>;
  objectKey: string;
  uploadUrl: string;
};

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
  completeUploadRequest?: (
    fileId: string,
    etag: string
  ) => Promise<CompleteUploadResponse>;
  createPresignedUploadRequest?: (
    file: File
  ) => Promise<PresignUploadResponse>;
  fetchImpl?: typeof fetch;
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

function createPresignedUpload(file: File) {
  return requestJson<PresignUploadResponse>("/api/upload/presign", {
    body: JSON.stringify({
      contentType: file.type || "application/pdf",
      filename: file.name,
      sizeBytes: file.size,
    }),
    headers: {
      "content-type": "application/json",
    },
    method: "POST",
  });
}

function completePresignedUpload(fileId: string, etag: string) {
  return requestJson<CompleteUploadResponse>("/api/upload/complete", {
    body: JSON.stringify({
      etag,
      fileId,
    }),
    headers: {
      "content-type": "application/json",
    },
    method: "POST",
  });
}

async function createPresignedUploadWithFetch(
  file: File,
  fetchImpl: typeof fetch
) {
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
  });

  const payload = (await response.json()) as
    | (PresignUploadResponse & {
        error?: {
          code: string;
          message: string;
        };
      })
    | null;

  if (!response.ok || !payload?.fileId || !payload.uploadUrl || !payload.objectKey) {
    throw new Error(
      payload?.error?.message ||
        payload?.error?.code ||
        "Unable to create upload URL"
    );
  }

  return payload;
}

async function completePresignedUploadWithFetch(
  fileId: string,
  etag: string,
  fetchImpl: typeof fetch
) {
  const response = await fetchImpl("/api/upload/complete", {
    body: JSON.stringify({
      etag,
      fileId,
    }),
    headers: {
      "content-type": "application/json",
    },
    method: "POST",
  });
  const payload = (await response.json()) as
    | ({
        error?: {
          code: string;
          message: string;
        };
      } & CompleteUploadResponse)
    | null;

  if (!response.ok) {
    const retryableError = new Error(
      payload?.error?.message ||
        payload?.error?.code ||
        "Unable to verify upload"
    ) as Error & { retryable?: boolean };
    retryableError.retryable = Boolean(payload?.retryable);
    throw retryableError;
  }

  return payload ?? {};
}

async function presignFile(
  file: File,
  createPresignedUploadRequest: (
    file: File
  ) => Promise<PresignUploadResponse>,
  signal: AbortSignal
): Promise<PresignResponse> {
  if (signal.aborted) {
    throw new DOMException("Upload canceled", "AbortError");
  }

  const payload = await createPresignedUploadRequest(file);

  return {
    fileId: payload.fileId,
    headers: payload.headers,
    objectKey: payload.objectKey,
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
  completeUploadRequest: (
    fileId: string,
    etag: string
  ) => Promise<CompleteUploadResponse>,
  signal: AbortSignal
) {
  if (signal.aborted) {
    throw new DOMException("Upload canceled", "AbortError");
  }

  try {
    await completeUploadRequest(fileId, normalizeEtag(etag));
  } catch (error) {
    if (error instanceof ApiClientError) {
      const retryableError = new Error(error.message) as Error & {
        retryable?: boolean;
      };
      retryableError.retryable = false;
      throw retryableError;
    }

    if (error instanceof Error) {
      throw error;
    }

    throw new Error("Unable to verify upload");
  }
}

async function completeWithRetry(
  fileId: string,
  etag: string,
  completeUploadRequest: (
    fileId: string,
    etag: string
  ) => Promise<CompleteUploadResponse>,
  signal: AbortSignal,
  sleep: (ms: number) => Promise<void>
) {
  try {
    await completeUpload(fileId, etag, completeUploadRequest, signal);
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

    await completeUpload(fileId, etag, completeUploadRequest, signal);
  }
}

export function startPresignedUploads(
  files: File[],
  runtime: UploadRuntime = {}
): UploadController {
  const createPresignedUploadRequest =
    runtime.createPresignedUploadRequest ??
    (runtime.fetchImpl
      ? (file: File) => createPresignedUploadWithFetch(file, runtime.fetchImpl!)
      : createPresignedUpload);
  const completeUploadRequest =
    runtime.completeUploadRequest ??
    (runtime.fetchImpl
      ? (fileId: string, etag: string) =>
          completePresignedUploadWithFetch(fileId, etag, runtime.fetchImpl!)
      : completePresignedUpload);
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

        const presigned = await presignFile(
          item.file,
          createPresignedUploadRequest,
          controller.signal
        );

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
          completeUploadRequest,
          controller.signal,
          sleep
        );

        item.status = "success";
        emit(item);

        completed.push({
          etag: uploaded.etag,
          fileId: presigned.fileId,
          filename: item.file.name,
          objectKey: presigned.objectKey,
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
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
