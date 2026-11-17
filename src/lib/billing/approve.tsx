import { renderToBuffer } from "@react-pdf/renderer";
import type { SupabaseClient } from "@supabase/supabase-js";
import { blockingTwin, type DupeRow } from "@/lib/billing/duplicates";
import { buildInvoiceDocument, pdfPath } from "@/lib/pdf/build";
import { InvoicePdf } from "@/lib/pdf/invoice-pdf";
import { qboIsConfigured } from "@/lib/quickbooks/client";
import { pushInvoice } from "@/lib/quickbooks/push";

/** Approves one draft, then stores its PDF exactly as issued. Returns an error message, or null. */
export async function approveOne(supabase: SupabaseClient, invoiceId: string): Promise<string | null> {
  // A draft that matches an invoice already issued (same property, date and amount) is never approved, so the same bill cannot go out twice.
  const columns = "id, account_id, invoice_number, status, origin, service_category, service_month, invoice_date, total_cents, late_fee_for";
  const { data: draft } = await supabase.from("invoices").select(columns).eq("id", invoiceId).maybeSingle();
  if (draft) {
    const { data: same } = await supabase.from("invoices").select(columns).eq("account_id", draft.account_id).eq("invoice_date", draft.invoice_date).eq("total_cents", draft.total_cents).neq("id", invoiceId);
    const twin = blockingTwin(draft as DupeRow, (same ?? []) as DupeRow[]);
    if (twin) return `Not approved: this is a duplicate of invoice ${twin.invoice_number}, which has the same property, date and amount. Reject this draft, or change it if it really is a different bill.`;
  }
  const { error } = await supabase.rpc("approve_invoice", { p_invoice_id: invoiceId });
  if (error) return error.message;
  try {
    const doc = await buildInvoiceDocument(supabase, invoiceId);
    const { data: invoice } = await supabase.from("invoices").select("account_id").eq("id", invoiceId).single();
    if (doc && invoice) {
      const buffer = await renderToBuffer(<InvoicePdf doc={doc} />);
      const upload = await supabase.storage
        .from("invoices")
        .upload(pdfPath(invoice.account_id, invoiceId), buffer, { contentType: "application/pdf", upsert: false });
      if (upload.error) return `Approved, but the PDF could not be stored: ${upload.error.message}`;
    }
  } catch (e) {
    return `Approved, but the PDF could not be stored: ${e instanceof Error ? e.message : "unknown error"}`;
  }
  // Once QuickBooks is connected, an approved invoice posts to the books straight away.
  // A failure here never undoes the approval: the invoice waits in Settings, QuickBooks.
  if (qboIsConfigured()) {
    const { count } = await supabase.from("qbo_connection").select("id", { count: "exact", head: true });
    if (count) {
      const problem = await pushInvoice(supabase, invoiceId);
      if (problem) return `Approved. ${problem}`;
    }
  }
  return null;
}
