import type { SupabaseClient } from "@supabase/supabase-js";
import type { Qbo } from "./client";

type QboLine = {
  DetailType?: string; Amount?: number; Description?: string;
  SalesItemLineDetail?: { Qty?: number; UnitPrice?: number; ItemRef?: { name?: string } };
};
export type QboInvoice = {
  Id: string; DocNumber?: string; TxnDate: string; DueDate?: string; TotalAmt: number; Balance: number;
  CustomerRef: { value: string; name?: string }; Line?: QboLine[];
};

const cents = (n: number | undefined) => Math.round(Number(n ?? 0) * 100);

/** Which of our services a QuickBooks product belongs to, judged by its name. */
export function serviceOf(itemNames: string[]): "valet" | "trash_room" | "bulk" | "other" {
  const main = itemNames.find((n) => !/late fee|discount/i.test(n)) ?? "";
  if (/valet/i.test(main)) return "valet";
  if (/trash room/i.test(main)) return "trash_room";
  if (/bulk/i.test(main)) return "bulk";
  return "other";
}

/** Turns one open QuickBooks invoice into what the database import expects. Pure, so it can be tested. */
export function toImportRow(inv: QboInvoice, accountId: string) {
  const sales = (inv.Line ?? []).filter((l) => l.DetailType === "SalesItemLineDetail");
  const lines = sales.map((l) => {
    const item = l.SalesItemLineDetail?.ItemRef?.name ?? "";
    const amount = cents(l.Amount);
    const qty = Number(l.SalesItemLineDetail?.Qty ?? 0);
    const unit = cents(l.SalesItemLineDetail?.UnitPrice);
    const lateFee = /late fee/i.test(item);
    // Keep units and rate only when they multiply out to the amount; QuickBooks late fee lines do not.
    const exact = qty !== 0 && Math.round(qty * unit) === amount;
    return {
      description: lateFee ? `Late fee${l.Description ? `, ${l.Description}` : ""}` : (l.Description?.trim() || item || "Service"),
      quantity: exact ? qty : 1,
      unit_price_cents: exact ? unit : amount,
      amount_cents: amount,
      line_type: lateFee ? "late_fee" : amount < 0 ? "adjustment" : "flat",
    };
  });
  const total = cents(inv.TotalAmt);
  // Anything QuickBooks adds outside the item lines (tax, for example) is carried as one line so the total matches.
  const gap = total - lines.reduce((s, l) => s + l.amount_cents, 0);
  if (gap !== 0) lines.push({ description: "Other charges on the QuickBooks invoice", quantity: 1, unit_price_cents: gap, amount_cents: gap, line_type: gap < 0 ? "adjustment" : "flat" });
  return {
    number: Number(inv.DocNumber),
    qbo_id: inv.Id,
    account_id: accountId,
    invoice_date: inv.TxnDate,
    due_date: inv.DueDate ?? inv.TxnDate,
    total_cents: total,
    open_cents: cents(inv.Balance),
    service: serviceOf(sales.map((l) => l.SalesItemLineDetail?.ItemRef?.name ?? "")),
    lines,
  };
}

export type ImportResult = { added: number; alreadyHere: number; addedCents: number; skipped: string[]; problems: string[] };

/** Brings in every invoice still open in QuickBooks for a linked property. Safe to repeat. */
export async function importOpenInvoices(supabase: SupabaseClient, qbo: Qbo): Promise<ImportResult | { error: string }> {
  let open = await qbo.query<QboInvoice>("select * from Invoice where Balance > '0' maxresults 1000");
  if ("error" in open) {
    // If QuickBooks will not filter on the balance, read the most recent thousand invoices and keep the open ones.
    const recent = await qbo.query<QboInvoice>("select * from Invoice orderby TxnDate desc maxresults 1000");
    if ("error" in recent) return recent;
    open = recent.filter((i) => Number(i.Balance) > 0);
  }
  const { data: accounts, error } = await supabase.from("billing_accounts").select("id, qbo_customer_id").eq("status", "active").not("qbo_customer_id", "is", null);
  if (error) return { error: error.message };
  const byCustomer = new Map((accounts ?? []).map((a) => [a.qbo_customer_id as string, a.id as string]));

  const result: ImportResult = { added: 0, alreadyHere: 0, addedCents: 0, skipped: [], problems: [] };
  for (const inv of [...open].sort((a, b) => a.TxnDate.localeCompare(b.TxnDate))) {
    const label = `${inv.DocNumber ?? "no number"} (${inv.CustomerRef.name ?? "unknown customer"}, $${Number(inv.Balance).toFixed(2)})`;
    const accountId = byCustomer.get(inv.CustomerRef.value);
    if (!accountId) { result.skipped.push(label); continue; }
    if (!/^\d+$/.test(inv.DocNumber ?? "")) { result.problems.push(`${label}: the invoice number is not a plain number.`); continue; }
    const row = toImportRow(inv, accountId);
    const { data, error: failed } = await supabase.rpc("import_qbo_open_invoice", { p: row });
    if (failed) result.problems.push(`${label}: ${failed.message}`);
    else if (data) { result.added += 1; result.addedCents += row.open_cents; }
    else result.alreadyHere += 1;
  }
  return result;
}
