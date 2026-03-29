export default function DashboardPage() {
  return (
    <main className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
      <section className="rounded-[2rem] border border-white/70 bg-white/80 p-8 shadow-[0_30px_80px_rgba(15,23,42,0.12)] backdrop-blur">
        <div className="space-y-4">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-slate-500">
            Session check
          </p>
          <h2 className="text-3xl font-black tracking-tight text-ink">
            Auth.js is active in App Router server components.
          </h2>
          <p className="max-w-2xl text-base leading-7 text-slate-600">
            This page is protected by middleware, and the surrounding protected
            layout validates the persisted Prisma session through{" "}
            <code>auth()</code> on the server.
          </p>
        </div>
      </section>

      <section className="rounded-[2rem] border border-white/70 bg-mist p-8 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
        <p className="text-sm font-semibold uppercase tracking-[0.3em] text-slate-500">
          Protected baseline
        </p>
        <div className="mt-6 space-y-4 text-sm text-slate-700">
          <div className="rounded-2xl bg-white px-4 py-3 shadow-sm">
            <p className="font-semibold text-slate-500">What this proves</p>
            <p className="mt-1 text-base font-medium text-ink">
              Auth-required routing, server session access, and sign-out are all
              wired before feature work lands.
            </p>
          </div>
          <div className="rounded-2xl bg-white px-4 py-3 shadow-sm">
            <p className="font-semibold text-slate-500">
              Current protected URL
            </p>
            <p className="mt-1 text-base font-medium text-ink">/dashboard</p>
          </div>
        </div>
      </section>
    </main>
  );
}
