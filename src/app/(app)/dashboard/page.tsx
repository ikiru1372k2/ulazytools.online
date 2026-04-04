import JobPollingPanel from "@/components/jobs/JobPollingPanel";
import PresignedUploader from "@/components/upload/PresignedUploader";

export default function DashboardPage() {
  return (
    <main className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
      <section className="rounded-[2rem] border border-white/70 bg-white/80 p-8 shadow-[0_30px_80px_rgba(15,23,42,0.12)] backdrop-blur">
        <div className="space-y-4">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-slate-500">
            Upload workflow
          </p>
          <h2 className="text-3xl font-black tracking-tight text-ink">
            Presigned PDF uploads now run inside the protected app.
          </h2>
          <p className="max-w-2xl text-base leading-7 text-slate-600">
            The dashboard is still protected by middleware and server session
            checks, but it now also hosts the first client uploader that
            presigns files, uploads them directly to storage, and verifies the
            result before handing back file IDs.
          </p>
        </div>
      </section>

      <section className="rounded-[2rem] border border-white/70 bg-mist p-8 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
        <p className="text-sm font-semibold uppercase tracking-[0.3em] text-slate-500">
          Active guarantees
        </p>
        <div className="mt-6 space-y-4 text-sm text-slate-700">
          <div className="rounded-2xl bg-white px-4 py-3 shadow-sm">
            <p className="font-semibold text-slate-500">What this proves</p>
            <p className="mt-1 text-base font-medium text-ink">
              Auth-required routing, server session access, presigned upload
              orchestration, and completion verification all work together.
            </p>
          </div>
          <div className="rounded-2xl bg-white px-4 py-3 shadow-sm">
            <p className="font-semibold text-slate-500">Current behavior</p>
            <p className="mt-1 text-base font-medium text-ink">
              Multiple PDFs queue sequentially, with progress and cancelation
              shown per file.
            </p>
          </div>
        </div>
      </section>

      <div className="lg:col-span-2">
        <PresignedUploader />
      </div>

      <div className="lg:col-span-2">
        <JobPollingPanel />
      </div>
    </main>
  );
}
