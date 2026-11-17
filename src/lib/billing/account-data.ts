import type { SupabaseClient } from "@supabase/supabase-js";
import type { BillingModel, Phase } from "./invoice-math";
import { billingPhases, type Decision } from "./escalation";
import { scheduleCell } from "./schedule";
import type { StatCredit, StatInvoice, StatPayment } from "./account-stats";

export type AccountContract = { status: string; billing_model: BillingModel; service_category: string | null; expected_monthly_cents: number | null; start_date: string | null; escalation_bps: number | null; phases: Phase[]; increases: Decision[] | null };

/** What a property is billed in a normal month: its monthly services, plus the usual amount for per-job work. */
export function monthlyCents(contracts: AccountContract[], month: string): number {
  let total = 0;
  for (const c of contracts.filter((x) => x.status !== "ended")) {
    if (c.billing_model === "per_event" || c.billing_model === "as_needed") total += Number(c.expected_monthly_cents ?? 0);
    else total += scheduleCell({ model: c.billing_model, phases: billingPhases(c, month), month, contractStart: c.start_date }).amountCents ?? 0;
  }
  return total;
}

export type Activity = { invoices: (StatInvoice & { account_id: string })[]; payments: (StatPayment & { account_id: string })[]; credits: (StatCredit & { account_id: string })[] };

/** Invoices, payments and credits for one property, or for all of them. */
export async function loadActivity(supabase: SupabaseClient, accountId?: string): Promise<Activity | { error: string }> {
  let invoices = supabase.from("invoices").select("id, account_id, invoice_number, status, invoice_date, due_date, total_cents, service_category, kind").neq("status", "draft");
  let applied = supabase.from("payment_applications").select("invoice_id, account_id, amount_cents, payment:payments(received_date)");
  let credits = supabase.from("credit_memos").select("invoice_id, account_id, amount_cents, memo_date");
  if (accountId) {
    invoices = invoices.eq("account_id", accountId);
    applied = applied.eq("account_id", accountId);
    credits = credits.eq("account_id", accountId);
  }
  const [i, p, c] = await Promise.all([invoices, applied, credits]);
  const failed = i.error ?? p.error ?? c.error;
  if (failed) return { error: failed.message };
  return {
    invoices: (i.data ?? []).map((r) => ({ ...r, total_cents: Number(r.total_cents) })) as Activity["invoices"],
    payments: ((p.data ?? []) as unknown as { invoice_id: string; account_id: string; amount_cents: number; payment: { received_date: string } | null }[]).map((r) => ({
      invoice_id: r.invoice_id, account_id: r.account_id, amount_cents: Number(r.amount_cents), date: r.payment?.received_date ?? "",
    })),
    credits: (c.data ?? []).map((r) => ({ invoice_id: r.invoice_id as string | null, account_id: r.account_id as string, amount_cents: Number(r.amount_cents), date: r.memo_date as string })),
  };
}
