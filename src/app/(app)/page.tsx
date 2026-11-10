import Link from "next/link";
import { Eyebrow, Empty, Monogram, PageHeader, primaryButton, Stat } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { formatCents } from "@/lib/money";
import type { AccountRow } from "./accounts/accounts-list";

export default async function DashboardPage() {
  const { supabase, name } = await requireAdmin();
  const { data } = await supabase.from("account_overview").select("*").order("balance_cents", { ascending: false });
  const rows = (data ?? []) as AccountRow[];
  const outstanding = rows.reduce((sum, r) => sum + Number(r.balance_cents), 0);
  const units = rows.reduce((sum, r) => sum + (r.unit_count ?? 0), 0);
  const customers = new Set(rows.map((r) => r.customer_name)).size;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Overview"
        title={`Welcome, ${name.split(" ")[0]}.`}
        description="Every balance here is the live sum of the ledger. Invoices, payments, and aging will fill in as each part of the app is switched on."
        action={<Link href="/accounts/new" className={primaryButton}>New Account</Link>}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="sm:col-span-2">
          <Stat dark label="Total outstanding" value={formatCents(outstanding)} detail="Across every account" />
        </div>
        <Stat label="Accounts" value={String(rows.length)} detail={`${customers} ${customers === 1 ? "customer" : "customers"}`} />
        <Stat label="Units under contract" value={units.toLocaleString("en-US")} detail="From property records" />
      </div>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <Eyebrow>Accounts</Eyebrow>
          <Link href="/accounts" className="text-sm font-medium text-ink underline-offset-4 hover:underline">View all</Link>
        </div>
        {rows.length === 0 ? (
          <Empty>No accounts yet. Create the first one with New Account.</Empty>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {rows.slice(0, 6).map((r) => (
              <li key={r.account_id}>
                <Link
                  href={`/accounts/${r.account_id}`}
                  className="flex items-center gap-4 rounded-2xl border border-line bg-white p-4 transition hover:-translate-y-0.5 hover:shadow-lg hover:shadow-slate-900/5"
                >
                  <Monogram name={r.property_name} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-ink">{r.property_name}</p>
                    <p className="truncate text-sm text-mute">{r.customer_name}</p>
                  </div>
                  <p className="font-semibold tabular-nums text-ink">{formatCents(Number(r.balance_cents))}</p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
