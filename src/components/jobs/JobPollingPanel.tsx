"use client";

import { useState } from "react";

import { useJobPoll } from "@/hooks/useJobPoll";
import { getJobStatusLabel } from "@/types/job";

export default function JobPollingPanel() {
  const [draftJobId, setDraftJobId] = useState("");
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);
  const { cancel, data, error, isLoading, isPaused, isPolling, restart } =
    useJobPoll(activeJobId, {
      enabled: Boolean(activeJobId),
    });

  const handleStart = () => {
    const trimmed = draftJobId.trim();

    if (!trimmed) {
      setInputError("Enter a job ID to start polling.");
      return;
    }

    setInputError(null);

    if (trimmed === activeJobId) {
      if (data?.status === "done") {
        return;
      }

      restart();
      return;
    }

    setActiveJobId(trimmed);
  };

  return (
    <section className="rounded-[2rem] border border-white/70 bg-white/90 p-8 shadow-[0_24px_60px_rgba(15,23,42,0.08)] backdrop-blur">
      <div className="space-y-6">
        <div className="space-y-2">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-slate-500">
            Job polling
          </p>
          <h2 className="text-3xl font-black tracking-tight text-ink">
            Poll the job status API with shared backoff logic.
          </h2>
          <p className="max-w-2xl text-sm leading-7 text-slate-600">
            This dashboard panel exercises the reusable polling hook before the
            app has a full job-creation flow wired into the uploader.
          </p>
        </div>

        <div className="rounded-[1.5rem] border border-dashed border-slate-300 bg-mist/80 p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
            <label className="flex-1 text-sm font-medium text-slate-700">
              Job ID
              <input
                className="mt-2 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-ink outline-none transition focus:border-slate-500"
                onChange={(event) => setDraftJobId(event.target.value)}
                placeholder="job_abc123"
                type="text"
                value={draftJobId}
              />
            </label>

            <div className="flex flex-wrap gap-3">
              <button
                className="rounded-full bg-ink px-5 py-3 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-slate-900"
                disabled={Boolean(activeJobId && data?.status === "done")}
                onClick={handleStart}
                type="button"
              >
                {activeJobId ? "Restart polling" : "Start polling"}
              </button>
              <button
                className="rounded-full border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
                disabled={!isPolling && !isLoading}
                onClick={cancel}
                type="button"
              >
                Cancel polling
              </button>
            </div>
          </div>

          {inputError ? (
            <p
              aria-live="polite"
              className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
              role="status"
            >
              {inputError}
            </p>
          ) : null}
        </div>

        <div className="rounded-[1.5rem] border border-slate-200 bg-white px-5 py-4 shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-2">
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">
                Poll state
              </p>
              <p className="text-base font-semibold text-ink">
                {activeJobId ? `Watching ${activeJobId}` : "No active job selected"}
              </p>
              <div className="flex flex-wrap gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-600">
                <span className="rounded-full bg-slate-100 px-3 py-1">
                  {isLoading ? "Request in flight" : "Idle"}
                </span>
                <span className="rounded-full bg-slate-100 px-3 py-1">
                  {isPolling ? "Polling active" : isPaused ? "Polling paused" : "Polling stopped"}
                </span>
                <span className="rounded-full bg-slate-100 px-3 py-1">
                  {isPaused ? "Paused by visibility" : "Visible"}
                </span>
              </div>
            </div>

            {data ? (
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-slate-600">
                {getJobStatusLabel(data.status)}
              </span>
            ) : null}
          </div>

          {error ? (
            <p
              aria-live="polite"
              className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900"
              role="status"
            >
              {error}
            </p>
          ) : null}

          {data ? (
            <div className="mt-4 rounded-2xl bg-mist px-4 py-4 text-sm text-slate-700">
              <p className="font-semibold text-slate-500">Latest response</p>
              <p className="mt-2 text-base font-medium text-ink">
                Status: {getJobStatusLabel(data.status)}
              </p>

              {"errorCode" in data && data.errorCode ? (
                <p className="mt-2">Error code: {data.errorCode}</p>
              ) : null}

              {"downloadUrl" in data ? (
                <a
                  className="mt-3 inline-flex rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700"
                  href={data.downloadUrl}
                >
                  Download result
                </a>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
