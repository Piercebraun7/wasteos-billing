import Link from "next/link";
import { Empty, Monogram, Notice, PageHeader, Stat } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { loadActivity, monthlyCents, type AccountContract } from "@/lib/billing/account-data";
import { accountStats } from "@/lib/billing/account-stats";
import { todayInPhoenix } from "@/lib/billing/dates";
import { formatDate } from "@/lib/format";
import { formatCents } from "@/lib/money";

type Account = { id: string; property: { name: string }; customer: { name: string }; contracts: AccountContract[] };

export default async function AccountsListPage() {
  const { supabase } = await requireAdmin();
  const today = todayInPhoenix();
  const month = `${today.slice(0, 7)}-01`;
  const [accountsRes, activity] = await Promise.all([
    supabase
      .from("billing_accounts")
      .select("id, property:properties(name), customer:customers(name), contracts(status, billing_model, service_category, expected_monthly_cents, start_date, escalation_bps, phases:contract_phases(*), increases:rate_increases(*))")
      .eq("status", "active"),
    loadActivity(supabase),
  ]);
  const problem = accountsRes.error?.message ?? ("error" in activity ? activity.error : null);
  const data = "error" in activity ? { invoices: [], payments: [], credits: [] } : activity;

  const rows = ((accountsRes.data ?? []) as unknown as Account[])
    .map((a) => ({
      account: a,
      monthly: monthlyCents(a.contracts, month),
      stats: accountStats(data.invoices.filter((i) => i.account_id === a.id), data.payments.filter((p) => p.account_id === a.id), data.credits.filter((c) => c.account_id === a.id), today),
    }))
    .sort((a, b) => b.stats.outstandingCents - a.stats.outstandingCents || a.account.property.name.localeCompare(b.account.property.name));
  const outstanding = rows.reduce((s, r) => s + r.stats.outstandingCents, 0);
  const overdue = rows.reduce((s, r) => s + r.stats.overdueCents, 0);
  const monthly = rows.reduce((s, r) => s + r.monthly, 0);

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Every property" title="Accounts" description="What each property owes, what it has paid, and its full history. Open one for the detail." />
      {problem && <Notice kind="error">Could not load accounts: {problem}</Notice>}

      <div className="grid gap-4 lg:grid-cols-3">
        <Stat dark label="Owed in total" value={formatCents(outstanding)} detail={`${rows.filter((r) => r.stats.outstandingCents > 0).length} of ${rows.length} properties have a balance`} />
        <Stat label="Overdue" value={formatCents(overdue)} detail={`${rows.filter((r) => r.stats.overdueCents > 0).length} propert${rows.filter((r) => r.stats.overdueCents > 0).length === 1 ? "y" : "ies"} past a due date`} />
        <Stat label="Billed in a normal month" value={formatCents(monthly)} detail="Monthly services plus the usual bulk" />
      </div>

      {rows.length === 0 ? (
        <Empty>No properties yet.</Empty>
      ) : (
        <div className="overflow-hidden rounded-3xl border border-line bg-white shadow-[0_1px_2px_rgb(16_24_40/0.04)]">
          <div className="hidden grid-cols-[1.6fr_repeat(4,minmax(0,1fr))] gap-4 border-b border-line px-5 py-3 font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-mute md:grid">
            <span>Property</span><span className="text-right">Owes</span><span className="text-right">Overdue</span><span className="text-right">Normal month</span><span className="text-right">Last payment</span>
          </div>
          <ul className="divide-y divide-line">
            {rows.map(({ account: a, stats, monthly: m }) => (
              <li key={a.id}>
                <Link href={`/customers/${a.id}`} className="grid items-center gap-x-4 gap-y-1 px-5 py-3.5 transition hover:bg-slate-50 md:grid-cols-[1.6fr_repeat(4,minmax(0,1fr))]">
                  <span className="flex min-w-0 items-center gap-3">
                    <Monogram name={a.property.name} />
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-ink">{a.property.name}</span>
                      <span className="block truncate text-sm text-mute">{a.customer.name}</span>
                    </span>
                  </span>
                  <span className="text-lg font-semibold tabular-nums text-ink md:text-right">{formatCents(stats.outstandingCents)}</span>
                  <span className={`tabular-nums md:text-right ${stats.overdueCents > 0 ? "font-semibold text-red-600" : "text-mute"}`}>{stats.overdueCents > 0 ? formatCents(stats.overdueCents) : "None"}</span>
                  <span className="tabular-nums text-slate-700 md:text-right">{m > 0 ? formatCents(m) : "Not set"}</span>
                  <span className="text-sm text-mute md:text-right">{stats.lastPayment ? `${formatCents(stats.lastPayment.amountCents)} on ${formatDate(stats.lastPayment.date)}` : "None yet"}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
