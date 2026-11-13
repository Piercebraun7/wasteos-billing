import Link from "next/link";
import { InvoiceTabs } from "@/components/section-tabs";
import { SubmitButton } from "@/components/submit-button";
import { Empty, inputClass, Notice, PageHeader, primaryButton, Stat } from "@/components/ui";
import { reminderEmail } from "@/lib/email/reminder-email";
import { emailIsConnected } from "@/lib/email/resend";
import { requireAdmin } from "@/lib/auth";
import { monthLabel, todayInPhoenix } from "@/lib/billing/dates";
import { formatDate } from "@/lib/format";
import { formatCents } from "@/lib/money";
import { isServiceCategory, SERVICES } from "@/lib/services";
import { dismissReminder, sendReminder } from "../send/actions";

type Row = {
  id: string;
  account_id: string;
  invoice_number: number | null;
  service_month: string;
  origin: string;
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

  const [invoicesRes, applications, credits, reminded, settings, overview] = await Promise.all([
    supabase
      .from("invoices")
      .select("id, account_id, invoice_number, service_month, invoice_date, due_date, status, kind, origin, service_category, total_cents, account:billing_accounts(property:properties(name), customer:customers(name))")
      .neq("status", "draft")
      .order("invoice_date", { ascending: false }),
    supabase.from("payment_applications").select("invoice_id, amount_cents"),
    supabase.from("credit_memos").select("invoice_id, amount_cents"),
    supabase.from("email_sends").select("invoice_id").eq("kind", "reminder"),
    supabase.from("app_settings").select("email_reply_to, email_signoff").maybeSingle(),
    supabase.from("account_overview").select("account_id, balance_cents"),
  ]);
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
  // Sent, reached its due date, still unpaid here, and no reminder decided yet.
  const reminders = open.filter((r) => ["sent", "partially_paid"].includes(r.status) && r.due_date <= today && !alreadyReminded.has(r.id));
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

      {view !== "paid" && reminders.length > 0 && (
        <section className="rounded-3xl border border-amber-200 bg-amber-50/60 p-5 sm:p-6">
          <h2 className="text-lg font-semibold tracking-tight text-ink">
            {reminders.length} reminder{reminders.length === 1 ? "" : "s"} ready
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            These invoices reached their due date and show as unpaid here. Each reminder is drafted and waits for you. Check that the payment has not arrived before sending.
          </p>
          <ul className="mt-4 space-y-3">
            {reminders.map((r) => {
              const email = reminderEmail({
                propertyName: r.account.property.name,
                invoiceNumber: Number(r.invoice_number),
                remainingCents: r.remaining,
                dueDate: r.due_date,
                balanceCents: balances.get(r.account_id) ?? r.remaining,
                replyTo: settings.data?.email_reply_to ?? null,
                signoff: settings.data?.email_signoff ?? "Kaizen Development Team",
                today,
                sentFromQuickBooksOn: r.origin === "quickbooks_import" ? r.invoice_date : null,
              });
              return (
                <li key={r.id} className="rounded-2xl border border-line bg-white p-4">
                  <form action={sendReminder}>
                    <input type="hidden" name="invoice_id" value={r.id} />
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="font-medium text-ink">
                        Invoice {r.invoice_number} · {r.account.property.name}
                        <span className="font-normal text-mute"> · {formatCents(r.remaining)} · was due {formatDate(r.due_date)}</span>
                      </p>
                      <div className="flex gap-2">
                        {connected ? <SubmitButton className={primaryButton}>Send reminder</SubmitButton> : <span className="self-center text-sm text-mute">Email not connected</span>}
                        <button formAction={dismissReminder} className="h-11 rounded-full px-4 text-sm font-medium text-slate-600 hover:bg-slate-100">Not needed</button>
                      </div>
                    </div>
                    <details className="mt-3 rounded-2xl border border-line">
                      <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-ink">Read or edit the reminder</summary>
                      <div className="space-y-3 border-t border-line p-4">
                        <input name="subject" defaultValue={email.subject} aria-label="Subject" className={inputClass} />
                        <textarea name="body" defaultValue={email.text} rows={14} aria-label="Message" className={`${inputClass} h-auto py-3 leading-relaxed`} />
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
