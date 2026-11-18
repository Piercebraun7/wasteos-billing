import type { SupabaseClient } from "@supabase/supabase-js";
import { formatDate } from "../format";
import { formatCents } from "../money";
import { monthStart } from "./dates";
import { feesToDraft, type FeeTerms } from "./late-fees";

type Inv = { id: string; account_id: string; invoice_number: number; status: string; due_date: string; total_cents: number; late_fee_for: string | null; late_fee_period: number | null };

/**
 * Drafts the late fees that have fallen due. Each fee is its own small draft
 * invoice, waiting in Review like any other, so nothing is charged or sent
 * until it is approved. Safe to run any number of times.
 * A property is only charged if its contract carries late fee terms.
 */
export async function draftLateFees(supabase: SupabaseClient, today: string): Promise<{ created: number; problems: string[] }> {
  const result = { created: 0, problems: [] as string[] };
  const [invoices, applications, credits, feeLines, accounts, waivers] = await Promise.all([
    supabase.from("invoices").select("id, account_id, invoice_number, status, due_date, total_cents, late_fee_for, late_fee_period"),
    supabase.from("payment_applications").select("invoice_id, amount_cents"),
    supabase.from("credit_memos").select("invoice_id, amount_cents"),
    supabase.from("invoice_lines").select("invoice_id").eq("line_type", "late_fee"),
    supabase.from("billing_accounts").select("id, contracts(status, created_at, late_fee_template:late_fee_templates(*))").eq("status", "active"),
    supabase.from("late_fee_waivers").select("invoice_id, period"),
  ]);
  const failed = invoices.error ?? applications.error ?? credits.error ?? feeLines.error ?? accounts.error ?? waivers.error;
  if (failed) return { created: 0, problems: [failed.message] };

  const all = (invoices.data ?? []) as Inv[];
  const reduced = new Map<string, number>();
  for (const r of [...(applications.data ?? []), ...(credits.data ?? [])]) if (r.invoice_id) reduced.set(r.invoice_id, (reduced.get(r.invoice_id) ?? 0) + Number(r.amount_cents));
  const openOf = (i: Inv) => Math.max(0, Number(i.total_cents) - (reduced.get(i.id) ?? 0));
  // Late fees QuickBooks put on an invoice before it was brought in count as periods already charged.
  const feeLinesOn = new Map<string, number>();
  for (const l of feeLines.data ?? []) feeLinesOn.set(l.invoice_id as string, (feeLinesOn.get(l.invoice_id as string) ?? 0) + 1);

  type Acct = { id: string; contracts: { status: string; created_at: string; late_fee_template: FeeTerms | null }[] };
  const termsFor = new Map<string, FeeTerms>();
  for (const a of (accounts.data ?? []) as unknown as Acct[]) {
    const withTerms = a.contracts.filter((c) => c.late_fee_template && c.status !== "ended").sort((x, y) => x.created_at.localeCompare(y.created_at))[0];
    if (withTerms?.late_fee_template) termsFor.set(a.id, withTerms.late_fee_template);
  }

  for (const inv of all) {
    // Fees are charged on real invoices that have been sent, never on a fee itself.
    if (inv.late_fee_for || !["sent", "partially_paid"].includes(inv.status)) continue;
    const terms = termsFor.get(inv.account_id);
    const open = openOf(inv);
    if (!terms || open <= 0) continue;
    // Every fee ever made for this invoice counts as a period used, including one that was removed or rejected, so a waived fee never comes back.
    const mine = all.filter((f) => f.late_fee_for === inv.id);
    const waived = (waivers.data ?? []).filter((w) => w.invoice_id === inv.id).map((w) => Number(w.period));
    const alreadyCharged = Math.max(feeLinesOn.get(inv.id) ?? 0, ...mine.map((f) => f.late_fee_period ?? 0), ...waived);
    const unpaidFeesCents = mine.filter((f) => f.status !== "void").reduce((s, f) => s + (f.status === "draft" ? Number(f.total_cents) : openOf(f)), 0);
    const due = feesToDraft({ dueDate: inv.due_date, openCents: open, alreadyCharged, unpaidFeesCents }, terms, today);

    for (const fee of due) {
      const percent = `${terms.percent_bps / 100}%`;
      const { data, error } = await supabase.rpc("create_draft_invoice", {
        p: {
          account_id: inv.account_id,
          service_month: monthStart(today),
          invoice_date: today,
          due_date: today,
          subtotal_cents: fee.amountCents,
          tax_cents: 0,
          total_cents: fee.amountCents,
          kind: "ad_hoc",
          service_category: "other",
          memo: `Late fee on invoice ${inv.invoice_number}, which was due ${formatDate(inv.due_date)}.`,
          lines: [{
            line_type: "late_fee",
            description: `Late fee, ${percent} of ${formatCents(fee.baseCents)} unpaid on invoice ${inv.invoice_number}`,
            quantity: "1",
            unit_price_cents: fee.amountCents,
            amount_cents: fee.amountCents,
            related_invoice_id: inv.id,
            period_start: fee.feeDate,
            period_end: fee.feeDate,
          }],
        },
      });
      if (error) { result.problems.push(`Invoice ${inv.invoice_number}: ${error.message}`); break; }
      const tagged = await supabase.from("invoices").update({ late_fee_for: inv.id, late_fee_period: fee.period }).eq("id", data as string);
      if (tagged.error) {
        // Someone else drafted this period a moment ago. Remove ours so there is only ever one.
        // The new draft is not tagged as a fee yet, so removing it records no waiver.
        await supabase.rpc("reject_draft", { p_invoice_id: data as string });
        if (tagged.error.code !== "23505") result.problems.push(`Invoice ${inv.invoice_number}: ${tagged.error.message}`);
        break;
      }
      result.created += 1;
    }
  }
  return result;
}
