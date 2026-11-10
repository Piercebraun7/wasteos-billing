import { redirect } from "next/navigation";
import { Wordmark } from "@/components/ui";
import { createClient, isBillingAdmin } from "@/lib/supabase/server";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (isBillingAdmin(user)) redirect("/");

  return (
    <main className="relative flex min-h-screen flex-1 flex-col overflow-hidden bg-night text-white">
      <div className="grid-lines pointer-events-none absolute inset-0" aria-hidden />
      <div
        className="pointer-events-none absolute -top-40 left-1/2 size-[720px] -translate-x-1/2 rounded-full opacity-25 blur-3xl"
        style={{ background: "radial-gradient(closest-side, #ff4b37, transparent)" }}
        aria-hidden
      />

      <header className="relative flex items-center justify-between px-6 py-6 sm:px-10">
        <Wordmark light />
        <p className="hidden font-mono text-[10px] uppercase tracking-[0.2em] text-white/40 sm:block">Restricted access</p>
      </header>

      <div className="relative flex flex-1 items-center justify-center px-4 pb-16">
        <div className="rise w-full max-w-[400px]">
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-tomato">Accounts receivable</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">Sign in.</h1>
          <p className="mt-3 text-[15px] leading-relaxed text-white/55">Billing, statements, and balances for Kaizen Waste.</p>
          <div className="mt-8 rounded-3xl border border-white/10 bg-white/[0.04] p-6 shadow-2xl shadow-black/40 backdrop-blur-xl">
            <LoginForm />
          </div>
        </div>
      </div>

      <footer className="relative flex items-center justify-between px-6 py-6 font-mono text-[10px] uppercase tracking-[0.2em] text-white/35 sm:px-10">
        <span>Kaizen Waste, LLC</span>
        <span>Phoenix, Arizona</span>
      </footer>
    </main>
  );
}
