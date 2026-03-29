import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { auth, signOut } from "@/lib/auth";

type AppLayoutProps = Readonly<{
  children: ReactNode;
}>;

export default async function AppLayout({ children }: AppLayoutProps) {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-6 py-10 sm:px-10">
      <header className="flex flex-col gap-4 rounded-[2rem] border border-white/70 bg-white/80 p-6 shadow-[0_30px_80px_rgba(15,23,42,0.12)] backdrop-blur sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-2">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-signal">
            Protected app
          </p>
          <div>
            <h1 className="text-2xl font-black tracking-tight text-ink">
              Welcome back{session.user.name ? `, ${session.user.name}` : ""}.
            </h1>
            <p className="text-sm text-slate-600">
              Signed in as {session.user.email ?? "an authenticated user"}.
            </p>
          </div>
        </div>

        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/login" });
          }}
        >
          <button
            className="rounded-full border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:-translate-y-0.5 hover:border-slate-400"
            type="submit"
          >
            Sign out
          </button>
        </form>
      </header>

      <div className="mt-8 flex-1">{children}</div>
    </div>
  );
}
