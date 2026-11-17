import Link from "next/link";
import { InvoiceTabs } from "@/components/section-tabs";
import { SubmitButton } from "@/components/submit-button";
import { Empty, inputClass, Notice, PageHeader, primaryButton, Stat } from "@/components/ui";
import { overdueEmail } from "@/lib/email/overdue-email";
import { emailIsConnected } from "@/lib/email/resend";
import { requireAdmin } from "@/lib/auth";
import { addDays, monthLabel, todayInPhoenix } from "@/lib/billing/dates";
import { formatDate } from "@/lib/format";
import { formatCents } from "@/lib/money";
import { isServiceCategory, SERVICES } from "@/lib/services";
import { checkLateFees, dismissOverdueNotice, sendOverdueNotice } from "../send/actions";

type Row = {
  id: string;
  account_id: string;
  invoice_number: number | null;
  service_month: string;
  origin: string;
  late_fee_for: string | null;
  invoice_date: string;
  due_date: string;
  status: string;
  kind: string;
  service_category: string | null;
  total_cents: number;
  account: { property: { name: string }; customer: { name: string } };
};

const VIEWS = ["unpaid", "overdue", "paid", "all"] as const;
type View = (typeof VIEWS)[number];

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<{ view?: string; saved?: string; error?: string }> }) {
  const { supabase } = await requireAdmin();
  const query = await searchParams;
  const wanted = query.view;
  const view: View = VIEWS.includes(wanted as View) ? (wanted as View) : "unpaid";
  const today = todayInPhoenix();

  const [invoicesRes, applications, credits, reminded, settings, overview, feeLines] = await Promise.all([
    supabase
      .from("invoices")
      .select("id, account_id, invoice_number, service_month, invoice_date, due_date, status, kind, origin, late_fee_for, service_category, total_cents, account:billing_accounts(property:properties(name), customer:customers(name))")
      .neq("status", "draft")
      .order("invoice_date", { ascending: false }),
    supabase.from("payment_applications").select("invoice_id, amount_cents"),
    supabase.from("credit_memos").select("invoice_id, amount_cents"),
    supabase.from("email_sends").select("invoice_id").eq("kind", "reminder"),
    supabase.from("app_settings").select("email_reply_to, email_signoff, overdue_grace_days").maybeSingle(),
    supabase.from("account_overview").select("account_id, balance_cents"),
    supabase.from("invoice_lines").select("invoice_id").eq("line_type", "late_fee"),
  ]);
  // Invoices that carry a late fee line themselves, which is how fees charged in QuickBooks arrive.
  const feeLineIds = new Set((feeLines.data ?? []).map((l) => l.invoice_id as string));
  const alreadyReminded = new Set((reminded.data ?? []).map((r) => r.invoice_id as string));
  const balances = new Map((overview.data ?? []).map((o) => [o.account_id as string, Number(o.balance_cents)]));
  const connected = emailIsConnected();
  const reduced = new Map<string, number>();
  for (const r of [...(applications.data ?? []), ...(credits.data ?? [])]) {
    if (r.invoice_id) reduced.set(r.invoice_id, (reduced.get(r.invoice_id) ?? 0) + Number(r.amount_cents));
  }
  const rows = ((invoicesRes.data ?? []) as unknown as Row[]).map((r) => {
    const remaining = r.status === "void" ? 0 : Math.max(0, Number(r.total_cents) - (reduced.get(r.id) ?? 0));
    const overdue = remaining > 0 && r.due_date < today;
    const state = r.status === "void" ? "Void" : remaining === 0 ? "Paid" : overdue ? "Overdue" : remaining < Number(r.total_cents) ? "Partly paid" : r.status === "approved" ? "Not sent yet" : "Sent";
    return { ...r, remaining, overdue, state };
  });
  const open = rows.filter((r) => r.remaining > 0);
  // One notice per property: every invoice that is past its due date and grace period, still unpaid here, with no notice decided yet.
  const graceDays = Number(settings.data?.overdue_grace_days ?? 5);
  const pastGrace = open.filter((r) => ["sent", "partially_paid"].includes(r.status) && addDays(r.due_date, graceDays) < today && !alreadyReminded.has(r.id));
  const feeFor = new Set(rows.filter((r) => r.late_fee_for && r.status !== "void").map((r) => r.late_fee_for as string));
  const notices = [...new Set(pastGrace.map((r) => r.account_id))]
    .map((accountId) => {
      const mine = pastGrace.filter((r) => r.account_id === accountId).sort((a, b) => a.due_date.localeCompare(b.due_date));
      return { accountId, name: mine[0].account.property.name, invoices: mine, total: mine.reduce((sum, r) => sum + r.remaining, 0), feesCharged: mine.some((r) => r.late_fee_for || feeFor.has(r.id) || feeLineIds.has(r.id)) };
    })
    .sort((a, b) => b.total - a.total);
  const shown = rows.filter((r) =>
    view === "all" ? true : view === "unpaid" ? r.remaining > 0 : view === "overdue" ? r.overdue : r.state === "Paid",
  );
  const outstanding = open.reduce((sum, r) => sum + r.remaining, 0);
  const overdueTotal = open.filter((r) => r.overdue).reduce((sum, r) => sum + r.remaining, 0);
  const pill: Record<string, string> = {
    Paid: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    Overdue: "bg-red-50 text-red-700 ring-red-200",
    "Partly paid": "bg-amber-50 text-amber-800 ring-amber-200",
    Sent: "bg-sky-50 text-sky-700 ring-sky-200",
    "Not sent yet": "bg-slate-50 text-slate-600 ring-slate-200",
    Void: "bg-slate-50 text-slate-400 ring-slate-200",
  };

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Receivables" title="Invoices" description="What has been paid, what has not, and what is still owed on each." />
      <InvoiceTabs supabase={supabase} current={view === "paid" ? "paid" : view === "all" ? "none" : "unpaid"} />
      {invoicesRes.error && <Notice kind="error">Could not load invoices: {invoicesRes.error.message}</Notice>}

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat dark label="Outstanding" value={formatCents(outstanding)} detail={`${open.length} unpaid invoice${open.length === 1 ? "" : "s"}`} />
        <Stat label="Overdue" value={formatCents(overdueTotal)} detail={`${open.filter((r) => r.overdue).length} past the due date`} />
        <Stat label="Paid in full" value={String(rows.filter((r) => r.state === "Paid").length)} detail="Invoices" />
      </div>

      {query.saved && <Notice kind="ok">{query.saved}</Notice>}
      {query.error && <Notice kind="error">{query.error}</Notice>}

      {view !== "paid" && (
        <section className="rounded-3xl border border-amber-200 bg-amber-50/60 p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold tracking-tight text-ink">
              {notices.length === 0 ? "No overdue notices to send" : `${notices.length} overdue notice${notices.length === 1 ? "" : "s"} ready`}
            </h2>
            <form action={checkLateFees}>
              <SubmitButton className="h-10 rounded-full border border-line bg-white px-4 text-sm font-medium text-ink hover:bg-slate-50">Check for late fees now</SubmitButton>
            </form>
          </div>
          <p className="mt-1 text-sm text-slate-600">
            An invoice gets {graceDays} days past its due date. After that, its property gets one notice covering everything overdue, and a 3% late fee is drafted for you to approve in Review. Each notice waits for you. Check that the payment has not arrived before sending.
          </p>
          <ul className="mt-4 space-y-3">
            {notices.map((n) => {
              const email = overdueEmail({
                propertyName: n.name,
                invoices: n.invoices.map((r) => ({ number: Number(r.invoice_number), dueDate: r.due_date, openCents: r.remaining, isLateFee: Boolean(r.late_fee_for) })),
                balanceCents: balances.get(n.accountId) ?? n.total,
                lateFeePercent: "3%",
                feesCharged: n.feesCharged,
                graceDays,
                replyTo: settings.data?.email_reply_to ?? null,
                signoff: settings.data?.email_signoff ?? "Kaizen Development Team",
              });
              return (
                <li key={n.accountId} className="rounded-2xl border border-line bg-white p-4">
                  <form action={sendOverdueNotice}>
                    <input type="hidden" name="account_id" value={n.accountId} />
                    <input type="hidden" name="invoice_ids" value={n.invoices.map((r) => r.id).join(",")} />
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="font-medium text-ink">
                        {n.name}
                        <span className="font-normal text-mute"> · {n.invoices.length} overdue · {formatCents(n.total)} · invoice{n.invoices.length === 1 ? "" : "s"} {n.invoices.map((r) => r.invoice_number).join(", ")}</span>
                      </p>
                      <div className="flex gap-2">
                        {connected ? <SubmitButton className={primaryButton}>Send notice</SubmitButton> : <span className="self-center text-sm text-mute">Email not connected</span>}
                        <button formAction={dismissOverdueNotice} className="h-11 rounded-full px-4 text-sm font-medium text-slate-600 hover:bg-slate-100">Not needed</button>
                      </div>
                    </div>
                    {!n.feesCharged && <p className="mt-2 text-sm text-amber-800">No late fee has been approved for this property yet, so the notice says the fee applies, not that it has been added.</p>}
                    <details className="mt-3 rounded-2xl border border-line">
                      <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-ink">Read or edit the notice</summary>
                      <div className="space-y-3 border-t border-line p-4">
                        <input name="subject" defaultValue={email.subject} aria-label="Subject" className={inputClass} />
                        <textarea name="body" defaultValue={email.text} rows={18} aria-label="Message" className={`${inputClass} h-auto py-3 leading-relaxed`} />
                      </div>
                    </details>
                  </form>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {view !== "paid" && (
        <div className="flex flex-wrap gap-4 text-sm font-medium">
          {([["unpaid", "All unpaid"], ["overdue", "Overdue only"], ["all", "Everything, including paid"]] as const).map(([key, label]) => (
            <Link key={key} href={`/invoices?view=${key}`} className={view === key ? "text-ink underline underline-offset-4" : "text-mute hover:text-ink"}>
              {label}
            </Link>
          ))}
        </div>
      )}

      {shown.length === 0 ? (
        <Empty>{rows.length === 0 ? "No invoices have been approved yet." : "Nothing in this view."}</Empty>
      ) : (
        <div className="overflow-hidden rounded-3xl border border-line bg-white shadow-[0_1px_2px_rgb(16_24_40/0.04)]">
          <div className="hidden grid-cols-[5.5rem_minmax(0,2fr)_minmax(0,1.3fr)_7rem_7.5rem_7.5rem_7.5rem] gap-4 border-b border-line px-6 py-3 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-mute lg:grid">
            <span>No.</span><span>Property</span><span>For</span><span>Due</span><span className="text-right">Total</span><span className="text-right">Still owed</span><span className="text-right">Status</span>
          </div>
          <ul className="divide-y divide-line">
            {shown.map((r) => {
              const service = SERVICES[isServiceCategory(r.service_category) ? r.service_category : "other"];
              return (
                <li key={r.id}>
                  <Link href={`/invoices/${r.id}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 py-4 transition hover:bg-slate-50 sm:px-6 lg:grid-cols-[5.5rem_minmax(0,2fr)_minmax(0,1.3fr)_7rem_7.5rem_7.5rem_7.5rem]">
                    <span className="hidden font-semibold tabular-nums text-ink lg:block">{r.invoice_number}</span>
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-ink">
                        <span className="lg:hidden">{r.invoice_number} · </span>
                        {r.account.property.name}
                      </span>
                      <span className="block truncate text-sm text-mute">{r.account.customer.name}</span>
                    </span>
                    <span className="hidden min-w-0 items-center gap-2 text-[15px] text-slate-600 lg:flex">
                      <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: service.hex }} aria-hidden />
                      <span className="truncate">{service.short}, {r.kind === "ad_hoc" ? formatDate(r.invoice_date) : monthLabel(r.service_month)}</span>
                    </span>
                    <span className={`hidden text-sm lg:block ${r.overdue ? "font-medium text-red-600" : "text-mute"}`}>{formatDate(r.due_date)}</span>
                    <span className="hidden text-right tabular-nums text-slate-600 lg:block">{formatCents(Number(r.total_cents))}</span>
                    <span className="text-right text-[17px] font-semibold tabular-nums text-ink">{formatCents(r.remaining)}</span>
                    <span className="hidden text-right lg:block">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${pill[r.state]}`}>{r.state}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
