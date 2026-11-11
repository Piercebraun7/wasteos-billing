import { renderToBuffer } from "@react-pdf/renderer";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildInvoiceDocument, pdfPath } from "@/lib/pdf/build";
import { InvoicePdf } from "@/lib/pdf/invoice-pdf";

/** Approves one draft, then stores its PDF exactly as issued. Returns an error message, or null. */
export async function approveOne(supabase: SupabaseClient, invoiceId: string): Promise<string | null> {
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
  return null;
}

