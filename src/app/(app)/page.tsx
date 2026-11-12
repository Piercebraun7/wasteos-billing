import Link from "next/link";
import { Empty, Eyebrow, Monogram, PageHeader, Stat } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { monthLabel, todayInPhoenix } from "@/lib/billing/dates";
import type { BillingModel, Phase } from "@/lib/billing/invoice-math";
import { scheduleCell } from "@/lib/billing/schedule";
import { formatDate } from "@/lib/format";
import { formatCents, lineAmountCents } from "@/lib/money";
import { categoryOfModel, isServiceCategory, SERVICE_ORDER, SERVICES, type ServiceCategory } from "@/lib/services";
import type { AccountRow } from "./accounts/accounts-list";

type Contract = { status: string; billing_model: BillingModel; service_category: string | null; expected_monthly_cents: number | null; start_date: string | null; phases: Phase[] };

export default async function HomePage() {
  const { supabase, name } = await requireAdmin();
  const today = todayInPhoenix();
  const month = `${today.slice(0, 7)}-01`;

  const [overview, open, applications, credits, drafts, approved, accounts, recurring, contacts] = await Promise.all([
    supabase.from("account_overview").select("*"),
    supabase.from("invoices").select("id, account_id, due_date, total_cents").in("status", ["approved", "sent", "partially_paid"]),
    supabase.from("payment_applications").select("invoice_id, amount_cents"),
    supabase.from("credit_memos").select("invoice_id, amount_cents"),
    supabase.from("invoices").select("id", { count: "exact", head: true }).eq("status", "draft"),
    supabase.from("invoices").select("id", { count: "exact", head: true }).eq("status", "approved"),
    supabase.from("billing_accounts").select("id, contracts(status, billing_model, service_category, expected_monthly_cents, start_date, phases:contract_phases(*))").eq("status", "active"),
    supabase.from("recurring_invoices").select("service_category, start_month, lines").eq("status", "active"),
    supabase.from("billing_contacts").select("account_id, delivery, confirmed_at"),
  ]);

  // Who owes money.
  const rows = ((overview.data ?? []) as AccountRow[]).filter((r) => r.status === "active");
  const outstanding = rows.reduce((sum, r) => sum + Math.max(0, Number(r.balance_cents)), 0);
  const reduced = new Map<string, number>();
  for (const r of [...(applications.data ?? []), ...(credits.data ?? [])]) {
    if (r.invoice_id) reduced.set(r.invoice_id, (reduced.get(r.invoice_id) ?? 0) + Number(r.amount_cents));
  }
  const overdueByAccount = new Map<string, number>();
  for (const inv of open.data ?? []) {
    const remaining = Number(inv.total_cents) - (reduced.get(inv.id) ?? 0);
    if (remaining > 0 && inv.due_date < today) overdueByAccount.set(inv.account_id, (overdueByAccount.get(inv.account_id) ?? 0) + remaining);
  }
  const overdue = [...overdueByAccount.values()].reduce((a, b) => a + b, 0);
  const owing = rows.filter((r) => Number(r.balance_cents) > 0).sort((a, b) => Number(b.balance_cents) - Number(a.balance_cents));

  // Monthly recurring revenue: every contract's scheduled amount this month, plus recurring invoices.
  const mrr: Record<ServiceCategory, number> = { valet: 0, trash_room: 0, bulk: 0, other: 0 };
  let bulkUsual = 0;
  let off = 0;
  type Acct = { id: string; contracts: Contract[] };
  for (const account of (accounts.data ?? []) as unknown as Acct[]) {
    const live = account.contracts.filter((c) => c.status !== "ended");
    if (live.length > 0 && !live.some((c) => c.status === "active")) off++;
    for (const c of live) {
      const category = isServiceCategory(c.service_category) ? c.service_category : categoryOfModel(c.billing_model);
      if (c.billing_model === "per_event" || c.billing_model === "as_needed") {
        bulkUsual += Number(c.expected_monthly_cents ?? 0);
        continue;
      }
      mrr[category] += scheduleCell({ model: c.billing_model, phases: c.phases, month, contractStart: c.start_date }).amountCents ?? 0;
    }
  }
  for (const r of recurring.data ?? []) {
    if (r.start_month > month) continue;
    const amount = (r.lines as { quantity: string; unit_price_cents: number }[]).reduce((sum, l) => sum + (lineAmountCents(String(l.quantity), Number(l.unit_price_cents)) ?? 0), 0);
    mrr[isServiceCategory(r.service_category) ? r.service_category : "other"] += amount;
  }
  const mrrTotal = SERVICE_ORDER.reduce((sum, c) => sum + mrr[c], 0);

  // What needs doing.
  const accountIds = new Set(rows.map((r) => r.account_id));
  const withTo = new Set((contacts.data ?? []).filter((c) => c.delivery !== "cc").map((c) => c.account_id as string));
  const unconfirmed = new Set((contacts.data ?? []).filter((c) => !c.confirmed_at).map((c) => c.account_id as string));
  const noContact = [...accountIds].filter((id) => !withTo.has(id)).length;
  const todo = [
    { n: drafts.count ?? 0, label: "to review", href: "/review" },
    { n: approved.count ?? 0, label: "approved and ready to send", href: "/send" },
    { n: owing.filter((r) => overdueByAccount.has(r.account_id)).length, label: "properties with an overdue invoice", href: "/invoices?view=overdue" },
    { n: noContact, label: "properties with no one to send to", href: "/contacts" },
    { n: [...unconfirmed].filter((id) => accountIds.has(id) && withTo.has(id)).length, label: "properties with contacts to confirm", href: "/contacts" },
    { n: off, label: "properties with billing switched off", href: "/schedule" },
  ].filter((t) => t.n > 0);

  return (
    <div className="space-y-8">
      <PageHeader eyebrow={formatDate(today)} title={`Welcome, ${name.split(" ")[0]}.`} />

      <div className="grid gap-4 lg:grid-cols-3">
        <Link href="/invoices?view=unpaid" className="block transition hover:-translate-y-0.5">
          <Stat dark label="Owed to you" value={formatCents(outstanding)} detail={`${owing.length} propert${owing.length === 1 ? "y" : "ies"} with a balance`} />
        </Link>
        <Link href="/invoices?view=overdue" className="block transition hover:-translate-y-0.5">
          <Stat label="Overdue" value={formatCents(overdue)} detail={`${overdueByAccount.size} past the due date`} />
        </Link>
        <Link href="/schedule" className="block transition hover:-translate-y-0.5">
          <Stat label={`Monthly recurring, ${monthLabel(month)}`} value={formatCents(mrrTotal)} detail={bulkUsual ? `Plus about ${formatCents(bulkUsual)} of bulk in a usual month` : "From contracts and recurring invoices"} />
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <section>
          <div className="mb-3 flex items-center justify-between">
            <Eyebrow>Owes the most</Eyebrow>
            <Link href="/accounts" className="text-sm font-medium text-ink underline-offset-4 hover:underline">All properties</Link>
          </div>
          {owing.length === 0 ? (
            <Empty>No one owes anything right now.</Empty>
          ) : (
            <ul className="divide-y divide-line overflow-hidden rounded-3xl border border-line bg-white shadow-[0_1px_2px_rgb(16_24_40/0.04)]">
              {owing.slice(0, 8).map((r) => {
                const late = overdueByAccount.get(r.account_id) ?? 0;
                return (
                  <li key={r.account_id}>
                    <Link href={`/accounts/${r.account_id}`} className="flex items-center gap-4 px-4 py-3.5 transition hover:bg-slate-50 sm:px-5">
                      <Monogram name={r.property_name} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-ink">{r.property_name}</span>
                        <span className="block truncate text-sm text-mute">
                          {r.customer_name}
                          {late > 0 && <span className="font-medium text-red-600"> · {formatCents(late)} overdue</span>}
                        </span>
                      </span>
                      <span className="text-lg font-semibold tabular-nums text-ink">{formatCents(Number(r.balance_cents))}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <div className="space-y-6">
          <section>
            <Eyebrow className="mb-3">Needs you</Eyebrow>
            {todo.length === 0 ? (
              <Empty>Nothing is waiting on you.</Empty>
            ) : (
              <ul className="divide-y divide-line overflow-hidden rounded-3xl border border-line bg-white shadow-[0_1px_2px_rgb(16_24_40/0.04)]">
                {todo.map((t) => (
                  <li key={t.label}>
                    <Link href={t.href} className="flex items-center gap-4 px-5 py-3.5 transition hover:bg-slate-50">
                      <span className="font-display min-w-9 text-2xl font-extrabold tabular-nums text-ink">{t.n}</span>
                      <span className="flex-1 text-[15px] text-slate-700">{t.label}</span>
                      <span className="text-mute" aria-hidden>&rarr;</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <Eyebrow className="mb-3">Monthly recurring by service</Eyebrow>
            <ul className="space-y-3 rounded-3xl border border-line bg-white p-5 shadow-[0_1px_2px_rgb(16_24_40/0.04)]">
              {SERVICE_ORDER.filter((c) => mrr[c] > 0 || c === "valet").map((c) => (
                <li key={c}>
                  <div className="flex items-center justify-between text-[15px]">
                    <span className="flex items-center gap-2 text-slate-700">
                      <span className="size-2.5 rounded-full" style={{ backgroundColor: SERVICES[c].hex }} aria-hidden />
                      {SERVICES[c].label}
                    </span>
                    <span className="font-semibold tabular-nums text-ink">{formatCents(mrr[c])}</span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full" style={{ width: `${mrrTotal ? Math.round((100 * mrr[c]) / mrrTotal) : 0}%`, backgroundColor: SERVICES[c].hex }} />
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
