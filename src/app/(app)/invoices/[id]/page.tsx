import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, Eyebrow, Notice, dangerButton, inputClass, secondaryButton } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { creditInvoice, voidInvoice } from "../actions";
import { requireAdmin } from "@/lib/auth";
import { monthLabel } from "@/lib/billing/dates";
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
  const [applied, memos] = await Promise.all([
    supabase.from("payment_applications").select("amount_cents").eq("invoice_id", id),
    supabase.from("credit_memos").select("id, amount_cents, reason, memo_date").eq("invoice_id", id).order("created_at"),
  ]);
  const credits = (memos.data ?? []) as { id: string; amount_cents: number; reason: string; memo_date: string }[];
  const credited = credits.reduce((sum, c) => sum + Number(c.amount_cents), 0);
  const paid = (applied.data ?? []).reduce((sum, a) => sum + Number(a.amount_cents), 0);
  const open = invoice.status === "void" ? 0 : Math.max(0, Number(invoice.total_cents) - credited - paid);
  const posted = ["approved", "sent", "partially_paid"].includes(invoice.status);
  const canVoid = ["approved", "sent"].includes(invoice.status) && credited === 0 && paid === 0;
  const lines = [...(invoice.lines as { id: string; description: string; amount_cents: number; sort_order: number }[])].sort((a, b) => a.sort_order - b.sort_order);

  return (
    <div className="space-y-5">
      <Link href={`/accounts/${invoice.account.id}`} className="inline-flex items-center gap-1.5 text-sm font-medium text-mute transition hover:text-ink">
        <span aria-hidden>&larr;</span> {invoice.account.property.name}
      </Link>
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
        <Card title="Lines">
          <ul className="divide-y divide-line text-[15px]">
            {lines.map((l) => (
              <li key={l.id} className="flex justify-between gap-4 py-2.5">
                <span className="text-slate-700">{l.description}</span>
                <span className="font-medium tabular-nums text-ink">{formatCents(Number(l.amount_cents))}</span>
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
          </div>
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
