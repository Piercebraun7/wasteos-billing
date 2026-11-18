import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, Eyebrow, Notice, dangerButton, inputClass, secondaryButton } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { creditInvoice, removeDraftLine, saveDraftDetails, saveDraftLine, voidInvoice } from "../actions";
import { AddLine } from "./add-line";
import { postOne } from "../../quickbooks/actions";
import { sendReminder } from "../../send/actions";
import { requireAdmin } from "@/lib/auth";
import { monthLabel, todayInPhoenix } from "@/lib/billing/dates";
import { emailIsConnected } from "@/lib/email/resend";
import { reminderEmail } from "@/lib/email/reminder-email";
import { formatDate } from "@/lib/format";
import { formatCents } from "@/lib/money";

const STATUS: Record<string, string> = {
  draft: "Draft", approved: "Approved, not sent", sent: "Sent", partially_paid: "Partly paid", paid: "Paid", void: "Void",
};

export default async function InvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { supabase } = await requireAdmin();
  const { id } = await params;
  const { saved, error: errorMessage } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const { data: invoice } = await supabase
    .from("invoices")
    .select("*, lines:invoice_lines!invoice_lines_invoice_id_fkey(*), account:billing_accounts(id, property:properties(name), customer:customers(name))")
    .eq("id", id)
    .maybeSingle();
  if (!invoice) notFound();
  const [applied, memos, settings, overview, lastReminder] = await Promise.all([
    supabase.from("payment_applications").select("amount_cents").eq("invoice_id", id),
    supabase.from("credit_memos").select("id, amount_cents, reason, memo_date").eq("invoice_id", id).order("created_at"),
    supabase.from("app_settings").select("email_reply_to, email_signoff").maybeSingle(),
    supabase.from("account_overview").select("balance_cents").eq("account_id", invoice.account.id).maybeSingle(),
    supabase.from("email_sends").select("sent_at, recipients").eq("invoice_id", id).eq("kind", "reminder").order("sent_at", { ascending: false }).limit(1),
  ]);
  const credits = (memos.data ?? []) as { id: string; amount_cents: number; reason: string; memo_date: string }[];
  const credited = credits.reduce((sum, c) => sum + Number(c.amount_cents), 0);
  const paid = (applied.data ?? []).reduce((sum, a) => sum + Number(a.amount_cents), 0);
  const open = invoice.status === "void" ? 0 : Math.max(0, Number(invoice.total_cents) - credited - paid);
  const posted = ["approved", "sent", "partially_paid"].includes(invoice.status);
  const canRemind = ["sent", "partially_paid"].includes(invoice.status) && open > 0;
  const reminded = (lastReminder.data ?? []).find((r) => (r.recipients as string[] | null)?.length);
  const reminder = canRemind
    ? reminderEmail({
        propertyName: invoice.account.property.name,
        invoiceNumber: Number(invoice.invoice_number),
        remainingCents: open,
        dueDate: invoice.due_date,
        balanceCents: Number(overview.data?.balance_cents ?? open),
        replyTo: settings.data?.email_reply_to ?? null,
        signoff: settings.data?.email_signoff ?? "Kaizen Development Team",
        today: todayInPhoenix(),
        sentFromQuickBooksOn: invoice.origin === "quickbooks_import" ? invoice.invoice_date : null,
      })
    : null;
  const canVoid = ["approved", "sent"].includes(invoice.status) && credited === 0 && paid === 0;
  const lines = [...(invoice.lines as { id: string; description: string; amount_cents: number; sort_order: number; period_start: string | null; quantity: number; unit_price_cents: number; line_type: string }[])].sort((a, b) => a.sort_order - b.sort_order);
  const isDraft = invoice.status === "draft";
  // Only needed while the invoice can still be changed.
  const [itemsRes, bulkRes] = isDraft
    ? await Promise.all([
        supabase.from("service_items").select("id, name, category, description, default_rate_cents").eq("is_active", true).order("sort_order"),
        supabase.from("contracts").select("event_rates:contract_event_rates(event_type, rate_cents)").eq("account_id", invoice.account.id).eq("service_category", "bulk"),
      ])
    : [null, null];
  const bulkRate = ((bulkRes?.data ?? []) as unknown as { event_rates: { event_type: string; rate_cents: number }[] }[]).flatMap((c) => c.event_rates).find((r) => r.event_type === "bulk_pickup")?.rate_cents ?? null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-x-5 gap-y-1">
        <Link href={isDraft ? "/review" : invoice.status === "approved" ? "/send" : "/invoices?view=unpaid"} className="inline-flex items-center gap-1.5 text-sm font-medium text-mute transition hover:text-ink">
          <span aria-hidden>&larr;</span> {isDraft ? "Back to Review" : invoice.status === "approved" ? "Back to Send" : "Back to Invoices"}
        </Link>
        <Link href={`/customers/${invoice.account.id}`} className="text-sm font-medium text-mute transition hover:text-ink">{invoice.account.property.name}&apos;s account</Link>
      </div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Eyebrow>{monthLabel(invoice.service_month)} · {STATUS[invoice.status] ?? invoice.status}</Eyebrow>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
            {invoice.invoice_number ? `Invoice ${invoice.invoice_number}` : "Draft invoice"}
          </h1>
          <p className="mt-1 text-[15px] text-mute">
            {invoice.account.property.name} · {invoice.account.customer.name} · dated {formatDate(invoice.invoice_date)} · due {formatDate(invoice.due_date)}
          </p>
        </div>
        <p className="text-4xl font-semibold tabular-nums tracking-tight text-ink">{formatCents(Number(invoice.total_cents))}</p>
      </div>

      {saved && <Notice kind="ok">{saved}</Notice>}
      {errorMessage && <Notice kind="error">{errorMessage}</Notice>}
      {invoice.status === "approved" && (
        <Notice kind="info">
          Approved and posted to the account. It has not been emailed yet: go to <Link href="/send" className="font-medium underline">Send</Link>.
        </Notice>
      )}
      {invoice.status === "void" && <Notice kind="info">Voided: {invoice.void_reason}. It stays on file, and its amount is off the balance.</Notice>}
      {invoice.memo && <p className="text-[15px] text-slate-600">{invoice.memo}</p>}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <Card title={isDraft ? "Edit this draft" : "Lines"}>
          {isDraft && (
            <div className="mb-5 space-y-5 border-b border-line pb-5">
              <form action={saveDraftDetails} className="grid gap-3 sm:grid-cols-2">
                <input type="hidden" name="invoice_id" value={invoice.id} />
                <label className="block">
                  <span className="mb-1 block text-sm font-medium text-ink">Invoice date</span>
                  <input type="date" name="invoice_date" defaultValue={invoice.invoice_date} required className={inputClass} />
                </label>
                <label className="block">
                  <span className="mb-1 block text-sm font-medium text-ink">Due date</span>
                  <input type="date" name="due_date" defaultValue={invoice.due_date} required className={inputClass} />
                </label>
                <label className="block sm:col-span-2">
                  <span className="mb-1 block text-sm font-medium text-ink">Message on the invoice</span>
                  <textarea name="memo" rows={2} defaultValue={invoice.memo ?? ""} className={`${inputClass} h-auto py-2.5`} />
                </label>
                <div className="sm:col-span-2">
                  <SubmitButton className={secondaryButton}>Save dates and message</SubmitButton>
                  {invoice.kind === "scheduled" && <p className="mt-2 text-xs text-mute">A monthly invoice is re-dated to the day you approve it, keeping the same number of days until it is due.</p>}
                </div>
              </form>
              <div className="space-y-3">
                <p className="text-sm font-semibold text-ink">Lines</p>
                {lines.map((l) => (
                  <form key={l.id} action={saveDraftLine} className="grid gap-2 rounded-2xl border border-line p-3 sm:grid-cols-[9.5rem_1fr]">
                    <input type="hidden" name="invoice_id" value={invoice.id} />
                    <input type="hidden" name="line_id" value={l.id} />
                    <input type="date" name="line_date" defaultValue={l.period_start ?? ""} aria-label="Date of service" className={inputClass} />
                    <input name="description" defaultValue={l.description} required aria-label="Description" className={inputClass} />
                    <div className="grid items-center gap-2 sm:col-span-2 sm:grid-cols-[5rem_7rem_1fr_auto]">
                      <input name="quantity" defaultValue={String(Number(l.quantity))} inputMode="decimal" aria-label="Quantity" className={`${inputClass} text-right tabular-nums`} />
                      <input name="rate" defaultValue={(Number(l.unit_price_cents) / 100).toFixed(2)} inputMode="decimal" aria-label="Rate in dollars" className={`${inputClass} text-right tabular-nums`} />
                      <p className="px-1 text-sm text-mute">Now {formatCents(Number(l.amount_cents))}</p>
                      <SubmitButton className={secondaryButton}>Save line</SubmitButton>
                    </div>
                  </form>
                ))}
              </div>
            </div>
          )}
          <ul className="divide-y divide-line text-[15px]">
            {lines.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-4 py-2.5">
                <span className="text-slate-700">{l.description}</span>
                <span className="flex items-center gap-3">
                  <span className="font-medium tabular-nums text-ink">{formatCents(Number(l.amount_cents))}</span>
                  {isDraft && lines.length > 1 && (
                    <form action={removeDraftLine}>
                      <input type="hidden" name="invoice_id" value={invoice.id} />
                      <input type="hidden" name="line_id" value={l.id} />
                      <SubmitButton className="rounded-full px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50">Remove</SubmitButton>
                    </form>
                  )}
                </span>
              </li>
            ))}
            <li className="flex justify-between gap-4 py-3 font-semibold text-ink">
              <span>This invoice</span>
              <span className="tabular-nums">{formatCents(Number(invoice.total_cents))}</span>
            </li>
          </ul>
          {(credited > 0 || paid > 0) && (
            <ul className="border-t border-line pt-2 text-[15px]">
              {paid > 0 && (
                <li className="flex justify-between gap-4 py-1.5 text-slate-700"><span>Payments</span><span className="tabular-nums">-{formatCents(paid)}</span></li>
              )}
              {credits.map((c) => (
                <li key={c.id} className="flex justify-between gap-4 py-1.5 text-slate-700">
                  <span>Credit, {formatDate(c.memo_date)}: {c.reason}</span>
                  <span className="tabular-nums">-{formatCents(Number(c.amount_cents))}</span>
                </li>
              ))}
              <li className="flex justify-between gap-4 py-2 font-semibold text-ink"><span>Still open</span><span className="tabular-nums">{formatCents(open)}</span></li>
            </ul>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href={`/invoices/${invoice.id}/pdf`} target="_blank" className={secondaryButton}>Open PDF</Link>
            {invoice.status === "draft" && <Link href="/review" className={secondaryButton}>Go to review queue</Link>}
            {invoice.invoice_number && invoice.status !== "void" && !invoice.qbo_invoice_id && (
              <form action={postOne}>
                <input type="hidden" name="invoice_id" value={invoice.id} />
                <SubmitButton className={secondaryButton}>Post to QuickBooks</SubmitButton>
              </form>
            )}
          </div>
          <div className="mt-2 text-sm text-mute">
            {invoice.qbo_invoice_id ? "In QuickBooks." : invoice.invoice_number ? "Not in QuickBooks yet." : ""}
          </div>
          {isDraft && (
            <div className="mt-6 space-y-3 border-t border-line pt-5">
              <p className="text-sm font-semibold text-ink">Add a line</p>
              <p className="text-sm text-mute">For extras on this invoice, such as a replacement can. Type to find a product or add a new one.</p>
              <AddLine invoiceId={invoice.id} items={(itemsRes?.data ?? []) as { id: string; name: string; category: string; description: string | null; default_rate_cents: number | null }[]} defaultDate={invoice.invoice_date} bulkRate={bulkRate === null ? null : Number(bulkRate)} />
            </div>
          )}
          {reminder && (
            <div className="mt-6 space-y-3 border-t border-line pt-5">
              <p className="text-sm font-semibold text-ink">Send a reminder</p>
              <p className="text-sm text-mute">
                {formatCents(open)} is still open. Check that the payment has not arrived before sending.
                {reminded ? ` The last reminder went out ${formatDate(String(reminded.sent_at).slice(0, 10))}.` : ""}
                {invoice.origin === "quickbooks_import" ? " This invoice was first sent from QuickBooks, so no copy is attached." : " A copy of the invoice is attached."}
              </p>
              <form action={sendReminder} className="space-y-3">
                <input type="hidden" name="invoice_id" value={invoice.id} />
                <input type="hidden" name="return_to" value="invoice" />
                <input name="subject" defaultValue={reminder.subject} aria-label="Subject" className={inputClass} />
                <textarea name="body" defaultValue={reminder.text} rows={12} aria-label="Message" className={`${inputClass} h-auto py-3 leading-relaxed`} />
                {emailIsConnected() ? <SubmitButton className={secondaryButton}>Send reminder</SubmitButton> : <span className="text-sm text-mute">Email not connected</span>}
              </form>
            </div>
          )}
          {invoice.late_fee_for && canVoid && (
            <div className="mt-6 space-y-3 border-t border-line pt-5">
              <p className="text-sm font-semibold text-ink">Late fee</p>
              <p className="text-sm text-mute">This is a late fee. Removing it takes the {formatCents(Number(invoice.total_cents))} off what the customer owes, and it will not be charged again for the same period.</p>
              <form action={voidInvoice}>
                <input type="hidden" name="invoice_id" value={invoice.id} />
                <input type="hidden" name="reason" value="Late fee removed" />
                <SubmitButton className={dangerButton}>Remove late fee</SubmitButton>
              </form>
            </div>
          )}
          {posted && (
            <div className="mt-6 space-y-3 border-t border-line pt-5">
              <p className="text-sm font-semibold text-ink">Fix this invoice</p>
              <p className="text-sm text-mute">A posted invoice is never edited. Give a credit for part of it, or void it and make a new one.</p>
              {open > 0 && (
                <details className="rounded-2xl border border-line p-3">
                  <summary className="cursor-pointer text-sm font-medium text-ink">Give a credit</summary>
                  <form action={creditInvoice} className="mt-3 grid gap-2 sm:grid-cols-[8rem_1fr_auto]">
                    <input type="hidden" name="invoice_id" value={invoice.id} />
                    <input type="hidden" name="account_id" value={invoice.account.id} />
                    <input name="amount" inputMode="decimal" required placeholder="Amount" aria-label="Credit amount" className={inputClass} />
                    <input name="reason" required placeholder="Reason (required)" aria-label="Reason for the credit" className={inputClass} />
                    <SubmitButton className={secondaryButton}>Apply credit</SubmitButton>
                  </form>
                  <p className="mt-2 text-xs text-mute">Up to {formatCents(open)}, the amount still open.</p>
                </details>
              )}
              {canVoid ? (
                <details className="rounded-2xl border border-line p-3">
                  <summary className="cursor-pointer text-sm font-medium text-ink">Void this invoice</summary>
                  <form action={voidInvoice} className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
                    <input type="hidden" name="invoice_id" value={invoice.id} />
                    <input name="reason" required placeholder="Reason (required)" aria-label="Reason for voiding" className={inputClass} />
                    <SubmitButton className={dangerButton}>Void invoice</SubmitButton>
                  </form>
                  <p className="mt-2 text-xs text-mute">
                    The full {formatCents(Number(invoice.total_cents))} comes off the balance. {invoice.status === "sent" ? "The customer already has this invoice, so let them know." : "It has not been emailed."}
                  </p>
                </details>
              ) : (
                <p className="text-xs text-mute">This invoice has a payment or credit on it, so it cannot be voided.</p>
              )}
            </div>
          )}
        </Card>
        <div className="overflow-hidden rounded-3xl border border-line bg-white">
          <iframe src={`/invoices/${invoice.id}/pdf#toolbar=0`} title="Invoice PDF preview" className="h-[720px] w-full" />
        </div>
      </div>
    </div>
  );
}
