import type { SupabaseClient } from "@supabase/supabase-js";
import { connect, type Qbo } from "./client";

type Line = { description: string; quantity: number; unit_price_cents: number; amount_cents: number; sort_order: number; line_type: string };
type InvoiceRow = {
  id: string; account_id: string; invoice_number: number | null; status: string; invoice_date: string; due_date: string;
  service_category: string | null; qbo_invoice_id: string | null; lines: Line[];
  account: { qbo_customer_id: string | null; property: { name: string } };
};

const dollars = (cents: number) => Number((cents / 100).toFixed(2));

/** Turns one stored line into a QuickBooks line. Pure, so it can be tested. */
export function qboLine(line: Line, itemId: string) {
  const amount = Number(line.amount_cents);
  const qty = Number(line.quantity);
  const unit = Number(line.unit_price_cents);
  // QuickBooks insists that quantity times price equals the amount. A prorated
  // line does not multiply out exactly, so it goes over as one unit at its amount.
  const exact = Number.isFinite(qty) && qty !== 0 && Math.round(qty * unit) === amount;
  return {
    DetailType: "SalesItemLineDetail",
    Amount: dollars(amount),
    Description: line.description,
    SalesItemLineDetail: { ItemRef: { value: itemId }, Qty: exact ? qty : 1, UnitPrice: exact ? dollars(unit) : dollars(amount) },
  };
}

/** Which QuickBooks product a service posts to, falling back to the catch-all. */
export function itemFor(itemMap: Record<string, string>, category: string | null): string | null {
  return itemMap[category ?? "other"] || itemMap.other || null;
}

async function log(supabase: SupabaseClient, invoiceId: string, status: "ok" | "failed" | "skipped", qboId: string | null, error: string | null) {
  await supabase.from("qbo_sync_log").insert({ record_table: "invoices", record_id: invoiceId, direction: "push", qbo_id: qboId, status, error_text: error });
}

/**
 * Posts one approved invoice to QuickBooks. Safe to repeat: an invoice that is
 * already there (by its link, or by its number) is linked and never created twice.
 * Returns an error message, or null.
 */
export async function pushInvoice(supabase: SupabaseClient, invoiceId: string, open?: Qbo): Promise<string | null> {
  const { data, error } = await supabase
    .from("invoices")
    .select("id, account_id, invoice_number, status, invoice_date, due_date, service_category, qbo_invoice_id, lines:invoice_lines!invoice_lines_invoice_id_fkey(description, quantity, unit_price_cents, amount_cents, sort_order, line_type), account:billing_accounts(qbo_customer_id, property:properties(name))")
    .eq("id", invoiceId)
    .maybeSingle();
  if (error) return error.message;
  const invoice = data as unknown as InvoiceRow | null;
  if (!invoice) return "Invoice not found.";
  if (invoice.qbo_invoice_id) return null;
  if (!invoice.invoice_number || !["approved", "sent", "partially_paid", "paid"].includes(invoice.status)) return "Only an approved invoice can be posted to QuickBooks.";
  const name = invoice.account.property.name;

  const fail = async (message: string) => {
    await log(supabase, invoiceId, "failed", null, message);
    return `Invoice ${invoice.invoice_number} was not posted to QuickBooks: ${message}`;
  };

  const qbo = open ?? (await connect(supabase));
  if ("error" in qbo) return fail(qbo.error);
  if (!invoice.account.qbo_customer_id) return fail(`${name} is not linked to a QuickBooks customer yet. Link it in Settings, QuickBooks.`);
  const itemId = itemFor(qbo.itemMap, invoice.service_category);
  if (!itemId) return fail("No QuickBooks product is chosen for this kind of service yet. Choose one in Settings, QuickBooks.");

  const link = async (qboId: string, status: "ok" | "skipped") => {
    const saved = await supabase.from("invoices").update({ qbo_invoice_id: qboId }).eq("id", invoiceId);
    if (saved.error) return fail(`It is in QuickBooks, but the link could not be saved here: ${saved.error.message}`);
    await log(supabase, invoiceId, status, qboId, null);
    return null;
  };

  // Already in QuickBooks under this number? Link it, do not create another.
  const number = String(invoice.invoice_number);
  const found = await qbo.query<{ Id: string }>(`select Id from Invoice where DocNumber = '${number.replace(/'/g, "")}'`);
  if ("error" in found) return fail(found.error);
  if (found.length > 0) return link(found[0].Id, "skipped");

  const lines = [...invoice.lines].sort((a, b) => a.sort_order - b.sort_order).map((l) => qboLine(l, itemId));
  const created = await qbo.post<{ Invoice?: { Id?: string; DocNumber?: string } }>(
    "/invoice",
    {
      DocNumber: number,
      TxnDate: invoice.invoice_date,
      DueDate: invoice.due_date,
      CustomerRef: { value: invoice.account.qbo_customer_id },
      Line: lines,
      // The billing app sends the email, so QuickBooks must not.
      EmailStatus: "NotSet",
      PrivateNote: `Kaizen billing app, invoice ${number}`,
    },
    // QuickBooks returns the same invoice for a repeated request id, so a retry can never make a second one.
    invoiceId,
  );
  if ("error" in created) return fail(created.error);
  if (!created.Invoice?.Id) return fail("QuickBooks did not confirm the invoice.");
  const problem = await link(created.Invoice.Id, "ok");
  if (problem) return problem;
  if (created.Invoice.DocNumber && created.Invoice.DocNumber !== number) {
    return `Invoice ${number} was posted, but QuickBooks numbered it ${created.Invoice.DocNumber}. Turn on custom transaction numbers in QuickBooks so the numbers match.`;
  }
  return null;
}
