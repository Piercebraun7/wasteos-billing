import { PropertyTabs } from "@/components/section-tabs";
import { Notice, PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { AccountsList, type AccountRow, type ContactRow } from "./accounts-list";

export default async function AccountsPage({ searchParams }: { searchParams: Promise<{ saved?: string }> }) {
  const { supabase } = await requireAdmin();
  const { saved } = await searchParams;
  const [{ data, error }, contacts] = await Promise.all([
    supabase.from("account_overview").select("*").order("property_name"),
    supabase.from("billing_contacts").select("account_id, name, email").order("created_at"),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Clients and their properties" title="Properties" description="Each client with its properties, what each owes, and who gets its invoices." />
      <PropertyTabs current="list" />
      {saved && <Notice kind="ok">{saved}</Notice>}
      {error ? (
        <Notice kind="error">Could not load clients: {error.message}</Notice>
      ) : (
        <AccountsList rows={(data ?? []) as AccountRow[]} contacts={(contacts.data ?? []) as ContactRow[]} />
      )}
    </div>
  );
}
