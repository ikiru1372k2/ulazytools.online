"use client";

import { useMemo, useState } from "react";
import { z } from "zod";

import PresignedUploader from "@/components/upload/PresignedUploader";
import { createSplitPdfRangesJob } from "@/lib/api/client";
import { splitPdfRangesSchema } from "@/lib/splitPdfRanges";
import type { UploadedFileResult } from "@/lib/upload/s3Put";
import { useJobPoll } from "@/hooks/useJobPoll";

const splitFormSchema = z.object({
  inputKey: z.string().trim().min(1, "Upload a PDF before starting."),
  ranges: splitPdfRangesSchema,
});

function getUiStatusLabel(
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

export default function SplitPdfPage() {
  const [uploadedFile, setUploadedFile] = useState<UploadedFileResult | null>(
    null
  );
  const [ranges, setRanges] = useState("");
  const [rangeTouched, setRangeTouched] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [initialStatus, setInitialStatus] = useState<
    "pending" | "processing" | "done" | "failed" | "canceled" | null
  >(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const formResult = useMemo(
    () =>
      splitFormSchema.safeParse({
        inputKey: uploadedFile?.objectKey ?? "",
        ranges,
      }),
    [ranges, uploadedFile]
  );

  const rangeIssue = formResult.success
    ? null
    : formResult.error.issues.find((issue) => issue.path[0] === "ranges")
        ?.message ?? null;
  const uploadIssue = formResult.success
    ? null
    : formResult.error.issues.find((issue) => issue.path[0] === "inputKey")
        ?.message ?? null;

  const { data, error, isLoading, isPaused, isPolling } = useJobPoll(
    activeJobId,
    {
      enabled: Boolean(activeJobId),
    }
  );

  const currentStatus = data?.status ?? initialStatus;
  const failureMessage =
    data?.status === "failed"
      ? data.errorMessage || data.errorCode || "The split job failed."
      : error;

  const handleUploadComplete = (completed: UploadedFileResult[]) => {
    setUploadedFile(completed[0] ?? null);
    setSubmitError(null);
    setActiveJobId(null);
    setInitialStatus(null);
  };

  const handleSubmit = async () => {
    setRangeTouched(true);
    setSubmitError(null);
    setActiveJobId(null);
    setInitialStatus(null);

    if (!formResult.success || !uploadedFile) {
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await createSplitPdfRangesJob({
        inputKey: uploadedFile.objectKey,
        ranges: formResult.data.ranges,
      });

      setInitialStatus(response.status);
      setActiveJobId(response.jobId);
    } catch (caughtError) {
      setSubmitError(
        caughtError instanceof Error && caughtError.message.trim()
          ? caughtError.message
          : "Unable to start the split job."
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="space-y-8" id="main-content">
      <section className="rounded-[2rem] border border-white/70 bg-white/85 p-8 shadow-[0_30px_80px_rgba(15,23,42,0.12)] backdrop-blur">
        <div className="space-y-4">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-signal">
            Split PDF
          </p>
          <h1 className="text-4xl font-black tracking-tight text-ink sm:text-5xl">
            Split one PDF into the page ranges you need.
          </h1>
          <p className="max-w-3xl text-base leading-7 text-slate-600">
            Upload a single PDF, enter page ranges like 1-3,5,8-10, then track
            the split job until the download is ready.
          </p>
        </div>
      </section>

      <PresignedUploader
        allowMultiple={false}
        buttonLabel="Select PDF"
        description="This public tool keeps the first split workflow simple: one source PDF, one ranges field, and a clear handoff into background processing."
        helperText="Upload one PDF, wait for verification, then start the split job."
        onComplete={handleUploadComplete}
        title="Upload the PDF you want to split."
      />

      <section className="rounded-[2rem] border border-white/70 bg-white/90 p-8 shadow-[0_24px_60px_rgba(15,23,42,0.08)] backdrop-blur">
        <div className="space-y-6">
          <div className="space-y-2">
            <p className="text-sm font-semibold uppercase tracking-[0.3em] text-slate-500">
              Split options
            </p>
            <h2 className="text-3xl font-black tracking-tight text-ink">
              Choose the page ranges to keep.
            </h2>
            <p className="max-w-2xl text-sm leading-7 text-slate-600">
              Use comma-separated ranges like 1-3,5,8-10. The tool validates the
              pattern before creating a job.
            </p>
          </div>

          <div className="grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
            <div className="space-y-4 rounded-[1.5rem] border border-dashed border-slate-300 bg-mist/80 p-5">
              <label className="block text-sm font-semibold text-slate-700">
                Page ranges
                <input
                  className="mt-3 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-ink outline-none transition focus:border-slate-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
                  onBlur={() => setRangeTouched(true)}
                  onChange={(event) => setRanges(event.target.value)}
                  placeholder="1-3,5,8-10"
                  type="text"
                  value={ranges}
                />
              </label>

              {rangeTouched && rangeIssue ? (
                <p
                  aria-live="polite"
                  className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
                  role="status"
                >
                  {rangeIssue}
                </p>
              ) : null}

              {!uploadedFile && uploadIssue ? (
                <p
                  aria-live="polite"
                  className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
                  role="status"
                >
                  {uploadIssue}
                </p>
              ) : null}

              {submitError ? (
                <p
                  aria-live="polite"
                  className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900"
                  role="status"
                >
                  {submitError}
                </p>
              ) : null}

              <button
                className="inline-flex rounded-full bg-ink px-5 py-3 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={!formResult.success || isSubmitting}
                onClick={handleSubmit}
                type="button"
              >
                {isSubmitting ? "Starting split..." : "Start split job"}
              </button>
            </div>

            <aside className="rounded-[1.5rem] border border-slate-200 bg-white px-5 py-4 shadow-sm">
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">
                Current input
              </p>
              <div className="mt-4 space-y-3 text-sm text-slate-700">
                <div className="rounded-2xl bg-mist px-4 py-3">
                  <p className="font-semibold text-slate-500">Uploaded file</p>
                  <p className="mt-1 text-base font-medium text-ink">
                    {uploadedFile?.filename ?? "No PDF uploaded yet"}
                  </p>
                </div>
                <div className="rounded-2xl bg-mist px-4 py-3">
                  <p className="font-semibold text-slate-500">Ranges</p>
                  <p className="mt-1 text-base font-medium text-ink">
                    {ranges.trim() || "No ranges entered yet"}
                  </p>
                </div>
              </div>
            </aside>
          </div>
        </div>
      </section>

      <section className="rounded-[2rem] border border-white/70 bg-white/90 p-8 shadow-[0_24px_60px_rgba(15,23,42,0.08)] backdrop-blur">
        <div className="space-y-6">
          <div className="space-y-2">
            <p className="text-sm font-semibold uppercase tracking-[0.3em] text-slate-500">
              Job progress
            </p>
            <h2 className="text-3xl font-black tracking-tight text-ink">
              Watch the split job move from queue to download.
            </h2>
          </div>

          <div className="rounded-[1.5rem] border border-slate-200 bg-white px-5 py-4 shadow-sm">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-2">
                <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">
                  Active job
                </p>
                <p className="text-base font-semibold text-ink">
                  {activeJobId
                    ? `Watching ${activeJobId}`
                    : "No split job started yet"}
                </p>
                <div className="flex flex-wrap gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-600">
                  <span className="rounded-full bg-slate-100 px-3 py-1">
                    {isLoading ? "Request in flight" : "Idle"}
                  </span>
                  <span className="rounded-full bg-slate-100 px-3 py-1">
                    {isPolling
                      ? "Polling active"
                      : isPaused
                        ? "Polling paused"
                        : "Polling stopped"}
                  </span>
                </div>
              </div>

              {currentStatus ? (
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-slate-600">
                  {getUiStatusLabel(currentStatus)}
                </span>
              ) : null}
            </div>

            {failureMessage ? (
              <p
                aria-live="polite"
                className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900"
                role="status"
              >
                {failureMessage}
              </p>
            ) : null}

            {data?.status === "done" ? (
              <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm text-emerald-900">
                <p className="font-semibold">Your split PDF is ready.</p>
                <a
                  className="mt-3 inline-flex rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700"
                  href={data.downloadUrl}
                >
                  Download split PDF
                </a>
              </div>
            ) : (
              <p className="mt-4 text-sm leading-7 text-slate-600">
                {currentStatus
                  ? "This panel updates automatically while the split job runs."
                  : "Upload a PDF and start a split job to see progress here."}
              </p>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
