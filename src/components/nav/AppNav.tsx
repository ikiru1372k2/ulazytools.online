"use client";

const navLinks = [
  {
    href: "/",
    label: "Home",
  },
  {
    href: "/tools",
    label: "Tools",
  },
  {
    href: "/dashboard",
    label: "Dashboard",
  },
] as const;

type AppNavProps = {
  currentPath?: string;
};

export default function AppNav({ currentPath }: AppNavProps) {
  return (
    <nav
      aria-label="Primary"
      className="rounded-[1.75rem] border border-white/70 bg-white/85 p-4 shadow-[0_24px_60px_rgba(15,23,42,0.08)] backdrop-blur"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-[0.35em] text-signal">
            ulazytools.online
          </p>
          <p className="text-sm text-slate-600">
            Browse shipped and upcoming document tools.
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
          {navLinks.map((link) => {
            const isActive = currentPath === link.href;

            return (
              <a
                key={link.href}
                aria-current={isActive ? "page" : undefined}
                className={`rounded-full px-4 py-2 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal ${
                  isActive
                    ? "bg-ink text-white"
                    : "border border-slate-300 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-50"
                }`}
                href={link.href}
              >
                {link.label}
              </a>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
