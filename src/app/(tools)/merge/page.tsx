"use client";

import { useRef, useState } from "react";

import PresignedUploader from "@/components/upload/PresignedUploader";
import { useJobPoll } from "@/hooks/useJobPoll";
import { createJob } from "@/lib/api/client";
import type { UploadedFileResult } from "@/lib/upload/s3Put";

function getMergeStatusLabel(
  status: "pending" | "processing" | "done" | "failed" | "canceled"
) {
  switch (status) {
    case "pending":
      return "Queued";
    case "processing":
      return "Processing";
    case "done":
      return "Done";
    case "failed":
      return "Failed";
    case "canceled":
      return "Canceled";
  }
}

export default function MergePage() {
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFileResult[]>([]);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const idempotencyKeyRef = useRef<string | null>(null);
  const { data: job, error: jobError, isLoading, isPaused, isPolling } =
    useJobPoll(activeJobId, {
      enabled: Boolean(activeJobId),
    });
  const hasActiveJob =
    isSubmitting ||
    job?.status === "pending" ||
    job?.status === "processing";
  const canSubmit = uploadedFiles.length >= 2 && !hasActiveJob;
  const statusLabel = job ? getMergeStatusLabel(job.status) : "Idle";
  const failedMessage =
    job?.status === "failed"
      ? job.lastError || job.errorCode || "Merge failed."
      : null;

  const handleStartMerge = async () => {
    if (uploadedFiles.length < 2) {
      setSubmissionError("Upload at least two PDFs before starting the merge.");
      return;
    }

    setIsSubmitting(true);
    setSubmissionError(null);
    idempotencyKeyRef.current ??=
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `merge-${Date.now()}`;

    try {
      const response = await createJob({
        inputFileIds: uploadedFiles.map((file) => file.fileId),
        jobType: "pdf.merge",
        options: {
          pageOrder: uploadedFiles.map((_, index) => index),
        },
      }, {
        idempotencyKey: idempotencyKeyRef.current,
      });

      setActiveJobId(response.jobId);
    } catch (error) {
      setSubmissionError(
        error instanceof Error && error.message.trim()
          ? error.message
          : "Unable to create merge job."
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUploadComplete = (completed: UploadedFileResult[]) => {
    setUploadedFiles(completed);
    setSubmissionError(null);
    setActiveJobId(null);
    idempotencyKeyRef.current = null;
  };

  return (
    <main className="space-y-8" id="main-content">
      <section className="rounded-[2rem] border border-white/70 bg-white/85 p-8 shadow-[0_30px_80px_rgba(15,23,42,0.12)] backdrop-blur">
        <div className="space-y-4">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-signal">
            Merge PDFs
          </p>
          <h1 className="text-4xl font-black tracking-tight text-ink sm:text-5xl">
            Upload multiple PDFs, choose merge options, and watch the job finish
            live.
          </h1>
          <p className="max-w-3xl text-base leading-7 text-slate-600">
            This public tool keeps the upload, job creation, polling, and
            download flow in one place for guests and signed-in users.
          </p>
        </div>
      </section>

      <PresignedUploader
        allowDrop
        description="Add two or more PDFs, verify them one by one, then start a merge job from the same page."
        helperText="Drag PDFs here or browse. Only verified uploads will be included in the merge."
        onComplete={handleUploadComplete}
        title="Upload the PDFs you want to merge."
      />

      <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <article className="rounded-[2rem] border border-white/70 bg-white/90 p-8 shadow-[0_24px_60px_rgba(15,23,42,0.08)] backdrop-blur">
          <div className="space-y-6">
            <div className="space-y-2">
              <p className="text-sm font-semibold uppercase tracking-[0.3em] text-slate-500">
                Merge options
              </p>
              <h2 className="text-3xl font-black tracking-tight text-ink">
                Review inputs and start the merge.
              </h2>
              <p className="text-sm leading-7 text-slate-600">
                Merges preserve the upload order shown above. This route now
                creates dedicated `pdf.merge` jobs and uses an idempotency key
                so retried submissions resolve to the same job instead of
                enqueueing duplicates.
              </p>
            </div>

            <div className="rounded-[1.5rem] border border-slate-200 bg-mist/70 p-5">
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">
                Ready files
              </p>
              <p className="mt-2 text-3xl font-black tracking-tight text-ink">
                {uploadedFiles.length}
              </p>
              <p className="mt-2 text-sm text-slate-600">
                {uploadedFiles.length >= 2
                  ? "Enough PDFs are ready for a merge."
                  : "Upload at least two PDFs to enable the merge button."}
              </p>
            </div>

            <div className="rounded-[1.5rem] border border-slate-200 bg-white px-4 py-4 text-sm text-slate-700">
              <p className="font-semibold text-ink">Merge order</p>
              <p className="mt-1 text-slate-600">
                Files are merged in the same order they finished uploading.
                Starting a new upload batch resets the pending merge request.
              </p>
            </div>

            {submissionError ? (
              <p
                aria-live="polite"
                className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900"
                role="status"
              >
                {submissionError}
              </p>
            ) : null}

            <button
              className="inline-flex rounded-full bg-ink px-5 py-3 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-slate-900 disabled:cursor-not-allowed disabled:bg-slate-400"
              disabled={!canSubmit}
              onClick={() => void handleStartMerge()}
              type="button"
            >
              {isSubmitting
                ? "Creating merge job..."
                : hasActiveJob
                  ? "Merge in progress..."
                  : "Start merge"}
            </button>
          </div>
        </article>

        <article className="rounded-[2rem] border border-white/70 bg-white/90 p-8 shadow-[0_24px_60px_rgba(15,23,42,0.08)] backdrop-blur">
          <div className="space-y-6">
            <div className="space-y-2">
              <p className="text-sm font-semibold uppercase tracking-[0.3em] text-slate-500">
                Job progress
              </p>
              <h2 className="text-3xl font-black tracking-tight text-ink">
                Follow the merge until the file is ready.
              </h2>
            </div>

            <div className="rounded-[1.5rem] border border-slate-200 bg-mist/70 px-5 py-4">
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">
                Current job
              </p>
              <p className="mt-2 text-base font-semibold text-ink">
                {activeJobId ? activeJobId : "No merge started yet"}
              </p>
              <div className="mt-4 flex flex-wrap gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-600">
                <span className="rounded-full bg-slate-100 px-3 py-1">
                  {statusLabel}
                </span>
                <span className="rounded-full bg-slate-100 px-3 py-1">
                  {isLoading ? "Request in flight" : "No active request"}
                </span>
                <span className="rounded-full bg-slate-100 px-3 py-1">
                  {isPolling
                    ? "Polling active"
                    : isPaused
                      ? "Polling paused"
                      : "Polling idle"}
                </span>
              </div>
            </div>

            {jobError ? (
              <p
                aria-live="polite"
                className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900"
                role="status"
              >
                {jobError}
              </p>
            ) : null}

            {failedMessage ? (
              <p
                aria-live="polite"
                className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900"
                role="status"
              >
                {failedMessage}
              </p>
            ) : null}

            {job?.status === "done" ? (
              <a
                className="inline-flex rounded-full bg-emerald-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700"
                href={job.downloadUrl}
              >
                Download merged PDF
              </a>
            ) : null}
          </div>
        </article>
      </section>
    </main>
  );
}
