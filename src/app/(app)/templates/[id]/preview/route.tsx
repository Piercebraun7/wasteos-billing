import { renderToBuffer } from "@react-pdf/renderer";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { InvoicePdf } from "@/lib/pdf/invoice-pdf";
import { resolveOptions } from "@/lib/pdf/template";

export const runtime = "nodejs";

/** A made-up invoice drawn with one template, so its layout can be checked before any real invoice uses it. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase } = await requireAdmin();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse("Template not found", { status: 404 });
  const [template, settings] = await Promise.all([
    supabase.from("invoice_templates").select("name, options").eq("id", id).maybeSingle(),
    supabase.from("app_settings").select("*").maybeSingle(),
  ]);
  if (!template.data) return new NextResponse("Template not found", { status: 404 });
  // The editor passes its unsaved ticks so the preview follows them; otherwise the saved version is drawn.
  let unsaved: unknown = null;
  try {
    const raw = new URL(request.url).searchParams.get("o");
    if (raw) unsaved = JSON.parse(raw);
  } catch {
    unsaved = null;
  }
  const layout = resolveOptions(unsaved ?? template.data.options);
  const company = settings.data;
  const contact = [company?.company_phone, company?.company_email].filter(Boolean).join(" or ");
  const buffer = await renderToBuffer(
    <InvoicePdf
      doc={{
        company: {
          name: company?.company_name ?? "Kaizen Waste, LLC",
          remittanceAddress: company?.remittance_address ?? "",
          achInstructions: company?.ach_instructions ?? null,
          contactLine: layout.contact && contact ? `Questions: ${contact}.` : "Questions: reply to the email this invoice came with.",
          phone: company?.company_phone ?? null,
          email: company?.company_email ?? null,
        },
        layout,
        invoice: { number: "0000", invoiceDate: "2026-12-01", dueDate: "2026-12-31", serviceMonth: "November 2026", servicePeriod: "Nov 1 to Nov 30, 2026", totalCents: 335000, isDraft: false, memo: null },
        billTo: { clientName: "Sample Management Company", propertyName: "Sample Property", addressLines: ["123 Example St", "Phoenix, AZ 85001"], reference: "SAMPLE-123" },
        charges: [
          { title: "Valet service", detail: "November 2026", units: "240", rateCents: 1250, amountCents: 300000 },
          { title: "Bulk pickup", detail: "November 2026 · Nov 3", units: "1", rateCents: 35000, amountCents: 35000 },
        ],
        nextMonth: { label: "December 2026", amountCents: 300000 },
        outstanding: {
          priorBalanceCents: 300000,
          unpaidInvoices: [{ number: "0000", date: "2026-11-01", remainingCents: 300000 }],
          lateFees: [],
          paymentsAndCredits: [],
        },
        totalAmountDueCents: 635000,
        showAch: layout.ach && Boolean(company?.ach_instructions?.trim()),
        terms: { netDays: company?.default_net_days ?? 30, lateFeeSentence: "A late fee of 3% of the unpaid balance applies once an invoice is past its due date, and again every 30 days until paid." },
      }}
    />,
  );
  return new NextResponse(new Uint8Array(buffer), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="Sample invoice, ${template.data.name.replace(/[^\w ,-]/g, "")}.pdf"`, "Cache-Control": "private, no-store" },
  });
}
