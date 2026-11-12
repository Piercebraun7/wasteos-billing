import Link from "next/link";
import { Nav } from "@/components/nav";
import { Wordmark } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { signOut } from "../login/actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { name, user } = await requireAdmin();
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <div className="flex min-h-screen flex-1 flex-col lg:flex-row">
      {/* Desktop: fixed dark rail. */}
      <aside className="relative hidden w-64 shrink-0 overflow-hidden bg-ink lg:fixed lg:inset-y-0 lg:flex lg:flex-col">
        <div className="grid-lines pointer-events-none absolute inset-0" aria-hidden />
        <div className="relative flex flex-1 flex-col p-5">
          <Link href="/" className="px-2 py-2">
            <Wordmark light />
          </Link>
          <p className="mt-8 px-3 font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-white/35">Workspace</p>
          <div className="mt-2">
            <Nav orientation="vertical" />
          </div>
          <div className="mt-auto rounded-2xl border border-white/10 bg-white/[0.04] p-3">
            <div className="flex items-center gap-3">
              <span className="flex size-9 items-center justify-center rounded-full bg-white/10 font-mono text-xs font-semibold text-white">{initials}</span>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-white">{name}</p>
                <p className="truncate text-xs text-white/45">{user.email}</p>
              </div>
            </div>
            <form action={signOut} className="mt-3">
              <button className="h-9 w-full rounded-full border border-white/15 text-xs font-medium text-white/80 transition hover:bg-white/10 hover:text-white">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </aside>

      {/* Phone and tablet: dark top bar. */}
      <header className="sticky top-0 z-20 bg-ink/95 backdrop-blur lg:hidden">
        <div className="flex items-center justify-between px-4 py-3">
          <Link href="/"><Wordmark light /></Link>
          <form action={signOut}>
            <button className="h-9 rounded-full border border-white/15 px-4 text-xs font-medium text-white/80">Sign out</button>
          </form>
        </div>
        <div className="px-3 pb-2">
          <Nav orientation="horizontal" />
        </div>
      </header>

      <main className="min-w-0 flex-1 lg:pl-64">
        <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-8 sm:py-12">{children}</div>
      </main>
    </div>
  );
}
