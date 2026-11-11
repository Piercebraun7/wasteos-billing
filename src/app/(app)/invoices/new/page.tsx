import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { todayInPhoenix } from "@/lib/billing/dates";
import { InvoiceForm } from "./invoice-form";

export default async function NewInvoicePage({ searchParams }: { searchParams: Promise<{ account?: string }> }) {
  const { supabase } = await requireAdmin();
  const [accounts, items, settings] = await Promise.all([
    supabase.from("account_overview").select("account_id, property_name, customer_name, balance_cents").order("property_name"),
    supabase.from("service_items").select("id, name, category, description, default_rate_cents").eq("is_active", true).order("sort_order"),
    supabase.from("app_settings").select("default_net_days").maybeSingle(),
  ]);
  const preselected = (await searchParams).account ?? "";

  return (
    <>
      <Link href="/review" className="inline-flex items-center gap-1.5 text-sm font-medium text-mute transition hover:text-ink">
        <span aria-hidden>&larr;</span> Review queue
      </Link>
      <div className="mt-4">
        <PageHeader
          eyebrow="One-off billing"
          title="Create invoice"
          description="For work outside the monthly schedule: a bulk pickup, a replacement can, a one-time job. It posts to the customer's account balance like any other invoice."
        />
      </div>
      <InvoiceForm
        accounts={(accounts.data ?? []) as { account_id: string; property_name: string; customer_name: string; balance_cents: number }[]}
        items={(items.data ?? []) as { id: string; name: string; category: string; description: string | null; default_rate_cents: number | null }[]}
        today={todayInPhoenix()}
        defaultNetDays={settings.data?.default_net_days ?? 30}
        preselected={preselected}
      />
    </>
  );
}
