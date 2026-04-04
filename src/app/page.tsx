import { uiPlaceholder } from "@/components/ui";

const highlights = [
  "Next.js 14 App Router foundation",
  "Strict TypeScript with alias-ready imports",
  "Tailwind-wired starter shell for future PDF tools",
];

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col justify-center px-6 py-16 sm:px-10">
      <div className="grid gap-10 lg:grid-cols-[1.3fr_0.7fr] lg:items-center">
        <section className="space-y-8">
          <span className="inline-flex w-fit items-center rounded-full border border-signal/20 bg-white/70 px-4 py-2 text-sm font-medium text-signal shadow-sm backdrop-blur">
            Issue #97 bootstrap complete
          </span>
          <div className="space-y-4">
            <p className="text-sm font-semibold uppercase tracking-[0.35em] text-signal">
              ulazytools.online
            </p>
            <h1 className="max-w-3xl text-4xl font-black tracking-tight text-ink sm:text-5xl lg:text-6xl">
              A clean web shell for the next phase of document tooling.
            </h1>
            <p className="max-w-2xl text-lg leading-8 text-slate-600">
              This starter app establishes the marketing surface, styling
              pipeline, and App Router structure before PDF workflows land.
            </p>
          </div>
          <div className="flex flex-wrap gap-4">
            <a
              className="rounded-full bg-ink px-6 py-3 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-slate-900"
              href="https://github.com/ikiru1372k2/ulazytools.online/issues/97"
            >
              View bootstrap issue
            </a>
            <a
              className="rounded-full border border-slate-300 bg-white/80 px-6 py-3 text-sm font-semibold text-slate-700 shadow-sm transition hover:-translate-y-0.5 hover:border-slate-400"
              href="/tools"
            >
              Browse tools
            </a>
            <a
              className="rounded-full border border-slate-300 bg-white/80 px-6 py-3 text-sm font-semibold text-slate-700 shadow-sm transition hover:-translate-y-0.5 hover:border-slate-400"
              href="/dashboard"
            >
              Open protected app
            </a>
            <div className="rounded-full border border-slate-300 bg-white/80 px-6 py-3 text-sm font-medium text-slate-700 shadow-sm">
              {uiPlaceholder}
            </div>
          </div>
        </section>

        <section className="rounded-[2rem] border border-white/70 bg-white/75 p-6 shadow-[0_30px_80px_rgba(15,23,42,0.12)] backdrop-blur">
          <div className="space-y-5">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.3em] text-slate-500">
                Ready now
              </p>
              <h2 className="mt-2 text-2xl font-bold text-ink">
                Verified project baseline
              </h2>
            </div>
            <ul className="space-y-3 text-sm text-slate-700">
              {highlights.map((item) => (
                <li
                  key={item}
                  className="flex items-start gap-3 rounded-2xl bg-mist px-4 py-3"
                >
                  <span className="mt-1 h-2.5 w-2.5 rounded-full bg-flare" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </div>
    </main>
  );
}
