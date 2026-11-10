import { redirect } from "next/navigation";
import { createClient, isBillingAdmin } from "@/lib/supabase/server";
import { signOut } from "./login/actions";

export const instant = false;

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Signed in but not an admin: end the session and show nothing.
  if (!isBillingAdmin(user)) {
    return (
      <main className="mx-auto w-full max-w-md px-4 py-16">
        <h1 className="text-xl font-bold text-slate-900">No access</h1>
        <p className="mt-2 text-slate-600">
          This account does not have access to Kaizen Billing.
        </p>
        <form action={signOut} className="mt-6">
          <button className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium">
            Sign out
          </button>
        </form>
      </main>
    );
  }

  const name =
    (user.user_metadata?.full_name as string | undefined) ?? user.email;

  return (
    <>
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-3">
          <p className="font-bold text-slate-900">
            <span className="text-[#FF4B37]">Kaizen</span> Billing
          </p>
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
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
        <p className="mt-1 text-slate-600">Signed in as {name}.</p>
        <div className="mt-8 rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-slate-500">
          Nothing here yet. Accounts, invoices, and balances will appear as
          each milestone is finished.
        </div>
      </main>
    </>
  );
}
