import Link from "next/link";
import { Notice, primaryButton } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { AccountsList, type AccountRow } from "./accounts-list";

export const instant = false;

export default async function AccountsPage() {
  const { supabase } = await requireAdmin();
  const { data, error } = await supabase.from("account_overview").select("*").order("property_name");

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-900">Accounts</h1>
        <Link href="/accounts/new" className={primaryButton}>New Account</Link>
      </div>
      {error ? (
        <div className="mt-4">
          <Notice kind="error">Could not load accounts: {error.message}</Notice>
        </div>
      ) : (
        <AccountsList rows={(data ?? []) as AccountRow[]} />
      )}
    </>
  );
}
