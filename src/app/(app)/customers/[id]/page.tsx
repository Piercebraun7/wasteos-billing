import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, Empty, Eyebrow, Notice, primaryButton, secondaryButton, Stat } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { loadActivity, monthlyCents, type AccountContract } from "@/lib/billing/account-data";
import { accountStats } from "@/lib/billing/account-stats";
import { todayInPhoenix } from "@/lib/billing/dates";
import { formatDate } from "@/lib/format";
import { formatCents } from "@/lib/money";
import { isServiceCategory, SERVICE_ORDER, SERVICES } from "@/lib/services";

type Account = {
  id: string; status: string; property: { name: string; address_line1: string | null; city: string | null; state: string | null; unit_count: number | null };
  customer: { name: string }; contracts: AccountContract[]; contacts: { name: string; email: string; delivery: string; is_active: boolean }[];
};

const PILL: Record<string, string> = {
  Paid: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  Overdue: "bg-red-50 text-red-700 ring-red-200",
  "Partly paid": "bg-amber-50 text-amber-800 ring-amber-200",
  Open: "bg-sky-50 text-sky-700 ring-sky-200",
  "Not sent yet": "bg-slate-50 text-slate-600 ring-slate-200",
  Void: "bg-slate-50 text-slate-400 ring-slate-200",
};

export default async function AccountPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ show?: string }> }) {
  const { supabase } = await requireAdmin();
  const { id } = await params;
  const { show } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const today = todayInPhoenix();
  const month = `${today.slice(0, 7)}-01`;

  const [accountRes, activity, feeLines] = await Promise.all([
    supabase
      .from("billing_accounts")
      .select("id, status, property:properties(name, address_line1, city, state, unit_count), customer:customers(name), contacts:billing_contacts(name, email, delivery, is_active), contracts(status, billing_model, service_category, expected_monthly_cents, start_date, escalation_bps, phases:contract_phases(*), increases:rate_increases(*))")
      .eq("id", id)
      .maybeSingle(),
    loadActivity(supabase, id),
    supabase.from("invoice_lines").select("invoice_id, amount_cents, invoice:invoices!invoice_lines_invoice_id_fkey!inner(account_id)").eq("line_type", "late_fee").eq("invoice.account_id", id),
  ]);
  const account = accountRes.data as unknown as Account | null;
  if (!account) notFound();
  const data = "error" in activity ? { invoices: [], payments: [], credits: [] } : activity;
  const stats = accountStats(data.invoices, data.payments, data.credits, today);
  const monthly = monthlyCents(account.contracts, month);

  // Late fees still unpaid: the fee lines on invoices that are still open, never more than what is open on each.
  const feeByInvoice = new Map<string, number>();
  for (const f of feeLines.data ?? []) feeByInvoice.set(f.invoice_id as string, (feeByInvoice.get(f.invoice_id as string) ?? 0) + Number(f.amount_cents));
  const lateFeesOpen = stats.invoices.reduce((s, i) => s + Math.min(i.openCents, feeByInvoice.get(i.id) ?? 0), 0);

  const view = show === "open" || show === "paid" ? show : "all";
  const shown = stats.invoices.filter((i) => (view === "open" ? i.openCents > 0 : view === "paid" ? i.state === "Paid" : true));
  const to = account.contacts.filter((c) => c.is_active && c.delivery !== "cc");
  const cc = account.contacts.filter((c) => c.is_active && c.delivery === "cc");
  const services = SERVICE_ORDER.filter((c) => (stats.openByService[c] ?? 0) > 0);

  return (
    <div className="space-y-6">
      <Link href="/customers" className="inline-flex items-center gap-1.5 text-sm font-medium text-mute transition hover:text-ink">
        <span aria-hidden>&larr;</span> All accounts
      </Link>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Eyebrow>{account.customer.name}{account.status !== "active" ? " · archived" : ""}</Eyebrow>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">{account.property.name}</h1>
          <p className="mt-1 text-[15px] text-mute">
            {[account.property.address_line1, account.property.city, account.property.state].filter(Boolean).join(", ") || "No address on file"}
            {account.property.unit_count ? ` · ${account.property.unit_count} units` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/invoices/new?account=${account.id}`} className={primaryButton}>Create invoice</Link>
          <Link href={`/accounts/${account.id}`} className={secondaryButton}>Rates and contacts</Link>
          <Link href={`/accounts/${account.id}/preview`} className={secondaryButton}>What the customer sees</Link>
        </div>
      </div>
      {"error" in activity && <Notice kind="error">Could not load this account&apos;s history: {activity.error}</Notice>}

      <div className="grid gap-4 lg:grid-cols-3">
        <Stat dark label="Overall bill: owed now" value={formatCents(stats.outstandingCents)} detail={stats.outstandingCents === 0 ? "Nothing owed" : `Across ${stats.invoices.filter((i) => i.openCents > 0).length} unpaid invoice${stats.invoices.filter((i) => i.openCents > 0).length === 1 ? "" : "s"}`} />
        <Stat label="Overdue" value={formatCents(stats.overdueCents)} detail={stats.overdueCents > 0 ? `${stats.invoices.filter((i) => i.overdue).length} past the due date` : "Nothing past its due date"} />
        <Stat label="Normal month" value={monthly > 0 ? formatCents(monthly) : "Not set"} detail="Monthly services plus the usual bulk" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Billed, last 12 months" value={formatCents(stats.billed12Cents)} />
        <Stat label="Paid, last 12 months" value={formatCents(stats.paid12Cents)} />
        <Stat label="Paid on time" value={stats.onTimePercent === null ? "No history" : `${stats.onTimePercent}%`} detail={stats.onTimePercent === null ? "Nothing paid in full yet" : `Of ${stats.paidInFull} invoice${stats.paidInFull === 1 ? "" : "s"} paid in full`} />
        <Stat label="Last payment" value={stats.lastPayment ? formatCents(stats.lastPayment.amountCents) : "None yet"} detail={stats.lastPayment ? formatDate(stats.lastPayment.date) : undefined} />
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
        <Card title="What the overall bill is made of" description="Everything still owed, by the service it was billed for.">
          {services.length === 0 ? (
            <p className="text-[15px] text-mute">Nothing is owed.</p>
          ) : (
            <ul className="divide-y divide-line text-[15px]">
              {services.map((c) => (
                <li key={c} className="flex items-center justify-between gap-4 py-2.5">
                  <span className="flex items-center gap-2 text-slate-700">
                    <span className="size-2.5 rounded-full" style={{ backgroundColor: SERVICES[c].hex }} aria-hidden />
                    {SERVICES[c].label}
                  </span>
                  <span className="font-semibold tabular-nums text-ink">{formatCents(stats.openByService[c])}</span>
                </li>
              ))}
              <li className="flex items-center justify-between gap-4 py-3 font-semibold text-ink">
                <span>Total owed</span>
                <span className="tabular-nums">{formatCents(stats.outstandingCents)}</span>
              </li>
            </ul>
          )}
          {lateFeesOpen > 0 && <p className="mt-2 text-sm text-mute">Of this, {formatCents(lateFeesOpen)} is late fees already on those invoices.</p>}
        </Card>
        <Card title="Who gets their invoices">
          {to.length === 0 ? (
            <p className="text-[15px] text-amber-700">No one yet. Nothing can be sent until a contact is added.</p>
          ) : (
            <ul className="space-y-1.5 text-[15px]">
              {[...to, ...cc].map((c) => (
                <li key={c.email} className="flex items-center gap-2">
                  <span className={`w-9 shrink-0 rounded-md py-0.5 text-center font-mono text-[10px] font-semibold uppercase tracking-wider ${c.delivery === "cc" ? "bg-slate-100 text-slate-600" : "bg-ink text-white"}`}>{c.delivery === "cc" ? "CC" : "To"}</span>
                  <span className="truncate text-slate-700">{c.email}</span>
                </li>
              ))}
            </ul>
          )}
          <Link href={`/accounts/${account.id}?tab=contacts`} className="mt-3 inline-block text-sm font-medium text-ink underline underline-offset-4">Change contacts</Link>
        </Card>
      </div>

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <Eyebrow>Invoices</Eyebrow>
          <div className="flex gap-1 rounded-full border border-line bg-white p-1">
            {([["all", "All"], ["open", "Unpaid"], ["paid", "Paid"]] as const).map(([key, label]) => (
              <Link key={key} href={key === "all" ? `/customers/${account.id}` : `/customers/${account.id}?show=${key}`} aria-current={view === key ? "page" : undefined} className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition ${view === key ? "bg-ink text-white" : "text-slate-600 hover:bg-slate-100"}`}>
                {label}
              </Link>
            ))}
          </div>
        </div>
        {shown.length === 0 ? (
          <Empty>{view === "all" ? "No invoices yet." : view === "open" ? "Nothing unpaid." : "Nothing paid yet."}</Empty>
        ) : (
          <div className="overflow-hidden rounded-3xl border border-line bg-white shadow-[0_1px_2px_rgb(16_24_40/0.04)]">
            <div className="hidden grid-cols-[1.4fr_1fr_1fr_1fr_1fr_auto] gap-4 border-b border-line px-5 py-3 font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-mute md:grid">
              <span>Invoice</span><span>Dated</span><span>Due</span><span className="text-right">Amount</span><span className="text-right">Still owed</span><span className="w-24 text-right">Status</span>
            </div>
            <ul className="divide-y divide-line">
              {shown.map((i) => {
                const category = isServiceCategory(i.service_category) ? i.service_category : "other";
                return (
                  <li key={i.id}>
                    <Link href={`/invoices/${i.id}`} className="grid items-center gap-x-4 gap-y-1 px-5 py-3 transition hover:bg-slate-50 md:grid-cols-[1.4fr_1fr_1fr_1fr_1fr_auto]">
                      <span className="flex items-center gap-2 font-medium text-ink">
                        <span className="size-2.5 rounded-full" style={{ backgroundColor: SERVICES[category].hex }} aria-hidden />
                        {i.invoice_number ?? "No number"} <span className="font-normal text-mute">· {SERVICES[category].short}</span>
                      </span>
                      <span className="text-sm text-slate-700">{formatDate(i.invoice_date)}</span>
                      <span className="text-sm text-slate-700">{formatDate(i.due_date)}{i.lastPaidOn && i.state === "Paid" ? ` · paid ${formatDate(i.lastPaidOn)}` : ""}</span>
                      <span className="tabular-nums text-slate-700 md:text-right">{formatCents(i.total_cents)}</span>
                      <span className={`tabular-nums md:text-right ${i.openCents > 0 ? "font-semibold text-ink" : "text-mute"}`}>{formatCents(i.openCents)}</span>
                      <span className="md:w-24 md:text-right"><span className={`inline-block rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${PILL[i.state]}`}>{i.state}</span></span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
