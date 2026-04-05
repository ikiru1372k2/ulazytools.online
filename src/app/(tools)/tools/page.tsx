"use client";

import { useMemo, useState } from "react";

type ToolCard = {
  category: string;
  description: string;
  href?: string;
  name: string;
  status: "planned" | "shipped";
};

const toolCards: ToolCard[] = [
  {
    category: "Upload workflow",
    description:
      "Protected dashboard surface for presigned PDF uploads, verification, and job polling.",
    href: "/dashboard",
    name: "PDF Upload Dashboard",
    status: "shipped",
  },
  {
    category: "Document transforms",
    description:
      "Public split workflow for one uploaded PDF, a typed ranges field, and background job progress.",
    href: "/split",
    name: "Split PDF by Ranges",
    status: "shipped",
  },
  {
    category: "Extraction",
    description:
      "Future structured extraction and OCR-style workflows will be discoverable from this hub.",
    name: "Extract Text and Data",
    status: "planned",
  },
  {
    category: "Delivery",
    description:
      "Job status, download delivery, and result management will expand into focused tool flows.",
    name: "Download and Review Results",
    status: "planned",
  },
];

function matchesSearch(card: ToolCard, query: string) {
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) {
    return true;
  }

  return [card.name, card.description, card.category, card.status]
    .join(" ")
    .toLowerCase()
    .includes(normalizedQuery);
}

export default function ToolsPage() {
  const [query, setQuery] = useState("");
  const filteredCards = useMemo(
    () => toolCards.filter((card) => matchesSearch(card, query)),
    [query]
  );

  return (
    <main className="space-y-8" id="main-content">
      <section className="rounded-[2rem] border border-white/70 bg-white/85 p-8 shadow-[0_30px_80px_rgba(15,23,42,0.12)] backdrop-blur">
        <div className="space-y-4">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-signal">
            Tools hub
          </p>
          <h1 className="text-4xl font-black tracking-tight text-ink sm:text-5xl">
            Browse every shipped and upcoming document workflow.
          </h1>
          <p className="max-w-3xl text-base leading-7 text-slate-600">
            Start from the public catalog, then jump into the protected app
            when a workflow is already live. The dashboard is the first shipped
            surface today, and more focused tool routes will branch out from
            here later.
          </p>
        </div>
      </section>

      <section className="rounded-[2rem] border border-white/70 bg-mist/90 p-6 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
        <label
          className="block text-sm font-semibold text-slate-700"
          htmlFor="tool-search"
        >
          Search tools
        </label>
        <input
          className="mt-3 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-ink outline-none transition focus:border-slate-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
          id="tool-search"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by tool, category, or status"
          type="search"
          value={query}
        />
      </section>

      {filteredCards.length ? (
        <section
          aria-label="Tool catalog"
          className="grid gap-5 md:grid-cols-2 xl:grid-cols-3"
        >
          {filteredCards.map((tool) => (
            <article
              key={tool.name}
              className={`rounded-[1.75rem] border border-white/70 bg-white/90 p-6 shadow-[0_24px_60px_rgba(15,23,42,0.08)] ${
                tool.status === "shipped"
                  ? "group transition hover:-translate-y-1 hover:shadow-[0_30px_80px_rgba(15,23,42,0.12)]"
                  : ""
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-500">
                    {tool.category}
                  </p>
                  <h2 className="mt-3 text-2xl font-black tracking-tight text-ink">
                    {tool.name}
                  </h2>
                </div>
                <span
                  className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] ${
                    tool.status === "shipped"
                      ? "bg-emerald-100 text-emerald-800"
                      : "bg-amber-100 text-amber-800"
                  }`}
                >
                  {tool.status}
                </span>
              </div>

              <p className="mt-4 text-sm leading-7 text-slate-600">
                {tool.description}
              </p>

              {tool.status === "shipped" && tool.href ? (
                <a
                  className="mt-6 inline-flex rounded-full border border-signal/20 bg-signal/10 px-4 py-2 text-sm font-semibold text-signal transition hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-signal"
                  href={tool.href}
                >
                  Open tool
                </a>
              ) : (
                <span className="mt-6 inline-flex rounded-full border border-slate-300 bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-600">
                  Coming soon
                </span>
              )}
            </article>
          ))}
        </section>
      ) : (
        <section
          aria-live="polite"
          className="rounded-[1.75rem] border border-dashed border-slate-300 bg-white/80 px-6 py-10 text-center shadow-sm"
        >
          <p className="text-lg font-semibold text-ink">
            No tools match that search.
          </p>
          <p className="mt-2 text-sm text-slate-600">
            Try a broader term like &quot;upload&quot;, &quot;dashboard&quot;,
            or &quot;planned&quot;.
          </p>
        </section>
      )}
    </main>
  );
}
