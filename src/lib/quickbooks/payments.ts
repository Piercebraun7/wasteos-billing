import type { SupabaseClient } from "@supabase/supabase-js";
import { todayInPhoenix } from "../billing/dates";
import type { Qbo } from "./client";
import { importOpenInvoices } from "./import";

type QboInvoiceState = { Id: string; TotalAmt: number; Balance: number; LinkedTxn?: { TxnId: string; TxnType: string }[] };
type QboPayment = { Id: string; TxnDate: string; PaymentRefNum?: string };

const cents = (n: number | undefined) => Math.round(Number(n ?? 0) * 100);
const chunks = <T,>(list: T[], size: number) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));

/** How much QuickBooks shows as paid on an invoice: its total less what is still open. */
export function paidInQuickBooks(inv: { TotalAmt: number; Balance: number }): number {
  return Math.max(0, cents(inv.TotalAmt) - cents(inv.Balance));
}

/** The most recent payment linked to an invoice, for its date and check number. */
export function latestPayment(inv: QboInvoiceState, payments: Map<string, QboPayment>): QboPayment | null {
  const linked = (inv.LinkedTxn ?? []).filter((t) => t.TxnType === "Payment").map((t) => payments.get(t.TxnId)).filter((p): p is QboPayment => Boolean(p));
  return linked.sort((a, b) => b.TxnDate.localeCompare(a.TxnDate))[0] ?? null;
}

export type SyncResult = { checked: number; payments: number; paidCents: number; brought: number; missing: string[]; problems: string[] };

/**
 * The daily check. Brings in any invoice newly opened in QuickBooks, then asks
 * QuickBooks what has been paid on every unpaid invoice here and records it
 * against that invoice. Safe to run any number of times.
 */
export async function syncFromQuickBooks(supabase: SupabaseClient, qbo: Qbo): Promise<SyncResult | { error: string }> {
  const result: SyncResult = { checked: 0, payments: 0, paidCents: 0, brought: 0, missing: [], problems: [] };

  const imported = await importOpenInvoices(supabase, qbo);
  if ("error" in imported) return imported;
  result.brought = imported.added;
  result.problems.push(...imported.problems);

  const { data: open, error } = await supabase
    .from("invoices")
    .select("id, invoice_number, qbo_invoice_id")
    .in("status", ["approved", "sent", "partially_paid"])
    .not("qbo_invoice_id", "is", null);
  if (error) return { error: error.message };
  const rows = (open ?? []) as { id: string; invoice_number: number; qbo_invoice_id: string }[];
  result.checked = rows.length;

  const states = new Map<string, QboInvoiceState>();
  for (const group of chunks(rows, 40)) {
    const ids = group.map((r) => `'${r.qbo_invoice_id.replace(/[^0-9A-Za-z-]/g, "")}'`).join(", ");
    const found = await qbo.query<QboInvoiceState>(`select * from Invoice where Id in (${ids}) maxresults 1000`);
    if ("error" in found) return found;
    for (const f of found) states.set(f.Id, f);
  }

  const paidOnes = rows.filter((r) => { const s = states.get(r.qbo_invoice_id); return s && paidInQuickBooks(s) > 0; });
  const paymentIds = [...new Set(paidOnes.flatMap((r) => (states.get(r.qbo_invoice_id)!.LinkedTxn ?? []).filter((t) => t.TxnType === "Payment").map((t) => t.TxnId)))];
  const payments = new Map<string, QboPayment>();
  for (const group of chunks(paymentIds, 40)) {
    const ids = group.map((id) => `'${id.replace(/[^0-9A-Za-z-]/g, "")}'`).join(", ");
    const found = await qbo.query<QboPayment>(`select * from Payment where Id in (${ids}) maxresults 1000`);
    if ("error" in found) return found;
    for (const f of found) payments.set(f.Id, f);
  }

  const today = todayInPhoenix();
  for (const r of rows) {
    const state = states.get(r.qbo_invoice_id);
    // Not there any more usually means it was voided or deleted in QuickBooks. That is a decision for a person.
    if (!state) { result.missing.push(String(r.invoice_number)); continue; }
    const paid = paidInQuickBooks(state);
    if (paid <= 0) continue;
    const last = latestPayment(state, payments);
    const { data, error: failed } = await supabase.rpc("record_qbo_paid", {
      p_invoice_id: r.id, p_paid_total_cents: paid, p_date: last?.TxnDate ?? today, p_reference: last?.PaymentRefNum ?? null, p_qbo_payment_id: last?.Id ?? null,
    });
    if (failed) result.problems.push(`Invoice ${r.invoice_number}: ${failed.message}`);
    else if (Number(data) > 0) { result.payments += 1; result.paidCents += Number(data); }
  }

  const note = syncNote(result);
  await supabase.from("qbo_connection").update({ last_synced_at: new Date().toISOString(), last_sync_note: note }).eq("singleton", true);
  await supabase.from("qbo_sync_log").insert({ record_table: "invoices", direction: "pull", status: result.problems.length ? "failed" : "ok", error_text: note });
  return result;
}

const money = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;

/** One plain sentence or two about what a check found. */
export function syncNote(r: SyncResult): string {
  return [
    r.payments ? `${r.payments} payment${r.payments === 1 ? "" : "s"} recorded, ${money(r.paidCents)} in total.` : `No new payments on the ${r.checked} unpaid invoice${r.checked === 1 ? "" : "s"} checked.`,
    r.brought ? `${r.brought} new QuickBooks invoice${r.brought === 1 ? "" : "s"} brought in.` : "",
    r.missing.length ? `No longer in QuickBooks, so left alone here: invoice ${r.missing.join(", ")}.` : "",
    r.problems.length ? `Problems: ${r.problems.join("; ")}.` : "",
  ].filter(Boolean).join(" ");
}
