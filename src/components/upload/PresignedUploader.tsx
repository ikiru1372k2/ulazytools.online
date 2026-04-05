"use client";

import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from "react";

import {
  startPresignedUploads,
  type UploadItem,
  type UploadedFileResult,
} from "@/lib/upload/s3Put";

type PresignedUploaderProps = {
  accept?: string;
  allowDrop?: boolean;
  description?: string;
  helperText?: string;
  onComplete?: (completed: UploadedFileResult[]) => void;
  selectLabel?: string;
  title?: string;
  validationMessage?: string;
  validateFile?: (file: File) => boolean;
};

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getStatusLabel(item: UploadItem) {
  switch (item.status) {
    case "queued":
      return "Queued";
    case "presigning":
      return "Preparing upload";
    case "uploading":
      return `Uploading ${item.progress}%`;
    case "completing":
      return "Verifying upload";
    case "success":
      return "Ready";
    case "error":
      return item.error || "Upload failed";
    case "canceled":
      return "Canceled";
    default:
      return item.status;
  }
}

function isPdf(file: File) {
  return file.type === "application/pdf";
}

export default function PresignedUploader({
  accept = "application/pdf,.pdf",
  allowDrop = false,
  description = "Files upload sequentially so progress, cancelation, and verification stay predictable in the first release.",
  helperText = "Uploads run one file at a time and return verified file IDs.",
  onComplete,
  selectLabel = "Select PDFs",
  title = "Upload large PDFs with visible progress.",
  validationMessage = "Only PDF files can be uploaded.",
  validateFile = isPdf,
}: PresignedUploaderProps) {
  const [itemsById, setItemsById] = useState<Record<string, UploadItem>>({});
  const [itemOrder, setItemOrder] = useState<string[]>([]);
  const [completedFiles, setCompletedFiles] = useState<UploadedFileResult[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragActive, setIsDragActive] = useState(false);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const itemIdsRef = useRef<string[]>([]);
  const controllerRef = useRef<ReturnType<typeof startPresignedUploads> | null>(
    null
  );

  useEffect(() => {
    return () => {
      mountedRef.current = false;

      const controller = controllerRef.current;

      if (!controller) {
        return;
      }

      itemIdsRef.current.forEach((localId) => {
        controller.cancel(localId);
      });
    };
  }, []);

  const handleItemUpdate = (nextItem: UploadItem) => {
    if (!mountedRef.current) {
      return;
    }

    setItemsById((current) => {
      const previous = current[nextItem.localId];

      if (
        previous &&
        previous.error === nextItem.error &&
        previous.progress === nextItem.progress &&
        previous.status === nextItem.status &&
        previous.fileId === nextItem.fileId &&
        previous.etag === nextItem.etag
      ) {
        return current;
      }

      return {
        ...current,
        [nextItem.localId]: nextItem,
      };
    });

    setItemOrder((current) => {
      if (current.includes(nextItem.localId)) {
        return current;
      }

      const nextOrder = [...current, nextItem.localId];
      itemIdsRef.current = nextOrder;
      return nextOrder;
    });
  };

  const beginUpload = async (selectedFiles: File[]) => {
    if (!selectedFiles.length) {
      return;
    }

    if (isUploading || controllerRef.current) {
      return;
    }

    const validFiles = selectedFiles.filter(validateFile);

    if (!validFiles.length || validFiles.length !== selectedFiles.length) {
      setSelectionError(validationMessage);
      return;
    }

    setSelectionError(null);
    setItemsById({});
    setItemOrder([]);
    setCompletedFiles([]);
    itemIdsRef.current = [];
    setIsUploading(true);

    const controller = startPresignedUploads(validFiles, {
      onBatchComplete: (completed) => {
        if (!mountedRef.current) {
          return;
        }

        setCompletedFiles(completed);
        onComplete?.(completed);
      },
      onItemUpdate: handleItemUpdate,
    });

    controllerRef.current = controller;

    try {
      await controller.promise;
    } finally {
      if (!mountedRef.current) {
        return;
      }

      controllerRef.current = null;
      setIsUploading(false);
    }
  };

  const handleSelection = async (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.target.files ?? []);

    event.target.value = "";

    await beginUpload(selectedFiles);
  };

  const items = itemOrder
    .map((localId) => itemsById[localId])
    .filter((item): item is UploadItem => Boolean(item));
  const hasVisibleItems = items.length > 0;

  return (
    <section className="rounded-[2rem] border border-white/70 bg-white/90 p-8 shadow-[0_24px_60px_rgba(15,23,42,0.08)] backdrop-blur">
      <div className="flex flex-col gap-6">
        <div className="space-y-3">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-slate-500">
            PDF upload
          </p>
          <div className="space-y-2">
            <h2 className="text-3xl font-black tracking-tight text-ink">
              {title}
            </h2>
            <p className="max-w-2xl text-sm leading-7 text-slate-600">
              {description}
            </p>
          </div>
        </div>

        <div
          className={`rounded-[1.5rem] border border-dashed p-5 transition ${
            isDragActive
              ? "border-signal bg-signal/10"
              : "border-slate-300 bg-mist/80"
          }`}
          onDragEnter={
            allowDrop && !isUploading
              ? (event) => {
                  event.preventDefault();
                  setIsDragActive(true);
                }
              : undefined
          }
          onDragLeave={
            allowDrop && !isUploading
              ? (event) => {
                  event.preventDefault();

                  if (
                    event.relatedTarget instanceof Node &&
                    event.currentTarget.contains(event.relatedTarget)
                  ) {
                    return;
                  }

                  setIsDragActive(false);
                }
              : undefined
          }
          onDragOver={
            allowDrop && !isUploading
              ? (event) => {
                  event.preventDefault();
                  setIsDragActive(true);
                }
              : undefined
          }
          onDrop={
            allowDrop && !isUploading
              ? (event) => {
                  event.preventDefault();
                  setIsDragActive(false);
                  void beginUpload(Array.from(event.dataTransfer.files ?? []));
                }
              : undefined
          }
        >
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-base font-semibold text-ink">
                {allowDrop
                  ? "Drag and drop PDFs or browse your device"
                  : "Choose one or more PDF files"}
              </p>
              <p className="mt-1 text-sm text-slate-600">
                {helperText}
              </p>
              {allowDrop ? (
                <p className="mt-2 text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
                  {isUploading ? "Drop disabled during upload" : "Drop files anywhere in this panel"}
                </p>
              ) : null}
            </div>

            <label className="inline-flex cursor-pointer items-center justify-center rounded-full bg-ink px-5 py-3 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-slate-900">
              <span>{isUploading ? "Uploading..." : selectLabel}</span>
              <input
                accept={accept}
                className="sr-only"
                disabled={isUploading}
                multiple
                onChange={handleSelection}
                type="file"
              />
            </label>
          </div>

          {selectionError ? (
            <p
              aria-live="polite"
              className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
              role="status"
            >
              {selectionError}
            </p>
          ) : null}
        </div>

        {hasVisibleItems ? (
          <div className="space-y-3">
            {items.map((item) => {
              const showCancel =
                item.status === "presigning" ||
                item.status === "uploading" ||
                item.status === "completing";

              return (
                <article
                  key={item.localId}
                  className="rounded-[1.5rem] border border-slate-200 bg-white px-5 py-4 shadow-sm"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-base font-semibold text-ink">
                        {item.file.name}
                      </p>
                      <p className="mt-1 text-sm text-slate-500">
                        {formatBytes(item.file.size)}
                      </p>
                    </div>

                    <div className="flex items-center gap-3">
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-slate-600">
                        {getStatusLabel(item)}
                      </span>
                      {showCancel ? (
                        <button
                          className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
                          onClick={() => controllerRef.current?.cancel(item.localId)}
                          type="button"
                        >
                          Cancel
                        </button>
                      ) : null}
                    </div>
                  </div>

                  <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-200">
                    <div
                      className="h-full rounded-full bg-teal-600 transition-all"
                      role="progressbar"
                      aria-label={`${item.file.name} upload progress`}
                      aria-valuemax={100}
                      aria-valuemin={0}
                      aria-valuenow={item.status === "canceled" ? 0 : item.progress}
                      style={{
                        width:
                          item.status === "canceled"
                            ? "0%"
                            : `${Math.max(
                                item.progress,
                                item.status === "success" ? 100 : 4
                              )}%`,
                      }}
                    />
                  </div>
                </article>
              );
            })}
          </div>
        ) : null}

        {completedFiles.length ? (
          <div
            aria-live="polite"
            className="rounded-[1.5rem] border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-900"
            role="status"
          >
            Uploaded {completedFiles.length} file
            {completedFiles.length === 1 ? "" : "s"} successfully.
          </div>
        ) : null}
      </div>
    </section>
  );
}
