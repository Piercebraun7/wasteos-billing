import { renderToBuffer } from "@react-pdf/renderer";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { buildInvoiceDocument, pdfPath } from "@/lib/pdf/build";
import { InvoicePdf } from "@/lib/pdf/invoice-pdf";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase } = await requireAdmin();
  const { id } = await params;
  const { data: invoice } = await supabase.from("invoices").select("id, account_id, status, invoice_number").eq("id", id).maybeSingle();
  if (!invoice) return new NextResponse("Invoice not found", { status: 404 });

  // An approved invoice is served from the stored copy, frozen as it was issued.
  if (invoice.status !== "draft") {
    const signed = await supabase.storage.from("invoices").createSignedUrl(pdfPath(invoice.account_id, invoice.id), 60);
    if (signed.data?.signedUrl) return NextResponse.redirect(signed.data.signedUrl);
  }

  const doc = await buildInvoiceDocument(supabase, id);
  if (!doc) return new NextResponse("Invoice not found", { status: 404 });
  const buffer = await renderToBuffer(<InvoicePdf doc={doc} />);
  const name = invoice.invoice_number ? `Kaizen Waste Invoice ${invoice.invoice_number}.pdf` : "Kaizen Waste Invoice Draft.pdf";
  return new NextResponse(new Uint8Array(buffer), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${name}"`, "Cache-Control": "private, no-store" },
  });
}
