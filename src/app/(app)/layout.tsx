import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { signOut } from "../login/actions";

export const instant = false;

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { name } = await requireAdmin();
  return (
    <>
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3">
          <div className="flex items-center gap-6">
            <Link href="/" className="font-bold text-slate-900">
              <span className="text-[#FF4B37]">Kaizen</span> Billing
            </Link>
            <nav className="flex gap-4 text-sm font-medium text-slate-700">
              <Link href="/" className="hover:text-black">Dashboard</Link>
              <Link href="/accounts" className="hover:text-black">Accounts</Link>
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-slate-600">{name}</span>
            <form action={signOut}>
              <button className="rounded-md border border-slate-300 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">{children}</main>
    </>
  );
}
