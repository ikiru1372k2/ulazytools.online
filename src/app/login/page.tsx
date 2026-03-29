import { redirect } from "next/navigation";
import { auth, signIn } from "@/lib/auth";

type LoginPageProps = {
  searchParams?: {
    next?: string;
  };
};

function getRedirectTarget(nextPath?: string) {
  if (!nextPath || !nextPath.startsWith("/") || nextPath.startsWith("//")) {
    return "/dashboard";
  }

  return nextPath;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const session = await auth();
  const redirectTarget = getRedirectTarget(searchParams?.next);

  if (session?.user) {
    redirect(redirectTarget);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl items-center px-6 py-16 sm:px-10">
      <section className="w-full rounded-[2rem] border border-white/70 bg-white/80 p-8 shadow-[0_30px_80px_rgba(15,23,42,0.12)] backdrop-blur">
        <div className="space-y-4">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-signal">
            Sign in required
          </p>
          <h1 className="text-3xl font-black tracking-tight text-ink sm:text-4xl">
            Access the protected app area.
          </h1>
          <p className="max-w-2xl text-base leading-7 text-slate-600">
            Google sign-in is enabled for local development so we can persist
            session-backed history and server-side access cleanly.
          </p>
        </div>

        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: redirectTarget });
          }}
          className="mt-8"
        >
          <button
            className="inline-flex items-center rounded-full bg-ink px-6 py-3 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-slate-900"
            type="submit"
          >
            Continue with Google
          </button>
        </form>
      </section>
    </main>
  );
}
