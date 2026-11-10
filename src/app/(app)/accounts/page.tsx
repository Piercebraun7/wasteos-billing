import Link from "next/link";
import { Notice, PageHeader, primaryButton } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { AccountsList, type AccountRow } from "./accounts-list";

export default async function AccountsPage() {
  const { supabase } = await requireAdmin();
  const { data, error } = await supabase.from("account_overview").select("*").order("property_name");

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Receivables"
        title="Accounts"
        description="One account per property, each with its own running balance."
        action={<Link href="/accounts/new" className={primaryButton}>New Account</Link>}
      />
      {error ? (
        <Notice kind="error">Could not load accounts: {error.message}</Notice>
      ) : (
        <AccountsList rows={(data ?? []) as AccountRow[]} />
      )}
    </div>
  );
}
