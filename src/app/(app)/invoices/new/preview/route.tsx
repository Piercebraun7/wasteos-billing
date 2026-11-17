import { renderToBuffer } from "@react-pdf/renderer";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { addDays, monthLabel, monthStart, shortDay } from "@/lib/billing/dates";
import { parseSignedDollarsToCents, lineAmountCents } from "@/lib/money";
import { InvoicePdf } from "@/lib/pdf/invoice-pdf";
import { withOverrides } from "@/lib/pdf/template";

export const runtime = "nodejs";

type PreviewLine = { item?: string; description?: string; quantity?: string; rate?: string; date?: string };
type Preview = { accountId?: string; invoiceDate?: string; netDays?: number; memo?: string; lines?: PreviewLine[]; options?: Record<string, boolean> };
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Draws the invoice being typed on the Create invoice page, before anything is saved. Nothing is stored. */
export async function GET(request: Request) {
  const { supabase } = await requireAdmin();
  let input: Preview = {};
  try {
    input = JSON.parse(new URL(request.url).searchParams.get("d") ?? "{}") as Preview;
  } catch {
    input = {};
  }
  const accountId = /^[0-9a-f-]{36}$/i.test(input.accountId ?? "") ? input.accountId! : null;
  const invoiceDate = DATE.test(input.invoiceDate ?? "") ? input.invoiceDate! : new Date().toISOString().slice(0, 10);
  const netDays = Number.isFinite(Number(input.netDays)) ? Math.max(0, Math.min(365, Number(input.netDays))) : 30;

  const [account, templates, settings, overview] = await Promise.all([
    accountId
      ? supabase.from("billing_accounts").select("customer_reference, invoice_template_id, property:properties(*), customer:customers(name)").eq("id", accountId).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from("invoice_templates").select("id, is_default, options"),
    supabase.from("app_settings").select("*").maybeSingle(),
    accountId ? supabase.from("account_overview").select("balance_cents").eq("account_id", accountId).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const acct = account.data as unknown as { customer_reference: string | null; invoice_template_id: string | null; property: Record<string, string | null>; customer: { name: string } } | null;
  const rows = (templates.data ?? []) as { id: string; is_default: boolean; options: unknown }[];
  const layout = withOverrides((rows.find((t) => t.id === acct?.invoice_template_id) ?? rows.find((t) => t.is_default))?.options, input.options);
  const company = settings.data;
  const contact = [company?.company_phone, company?.company_email].filter(Boolean).join(" or ");

  const charges = (input.lines ?? []).slice(0, 40).flatMap((l) => {
    const rate = parseSignedDollarsToCents(String(l.rate ?? ""));
    const quantity = String(l.quantity ?? "").trim() || "1";
    const amount = rate === null ? null : lineAmountCents(quantity, rate);
    const title = (l.item ?? "").trim() || (l.description ?? "").trim();
    if (!title || rate === null || amount === null) return [];
    const served = DATE.test(l.date ?? "") ? `${shortDay(l.date!)}, ${l.date!.slice(0, 4)}` : "";
    const description = (l.description ?? "").trim();
    return [{ title, detail: [served, description && description !== title ? description : ""].filter(Boolean).join(" · "), units: String(Number(quantity)), rateCents: rate, amountCents: amount }];
  });
  const total = charges.reduce((sum, c) => sum + c.amountCents, 0);
  const prior = Number(overview.data?.balance_cents ?? 0);
  const p = acct?.property;
  const cityLine = p ? [p.city, [p.state, p.postal_code].filter(Boolean).join(" ")].filter(Boolean).join(", ") : "";

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
        invoice: { number: "Draft", invoiceDate, dueDate: addDays(invoiceDate, netDays), serviceMonth: monthLabel(monthStart(invoiceDate)), servicePeriod: null, totalCents: total, isDraft: true, memo: (input.memo ?? "").trim().slice(0, 600) || null },
        billTo: {
          clientName: acct?.customer.name ?? "Management company",
          propertyName: p?.name ?? "Choose a customer",
          addressLines: p ? ([p.address_line1, p.address_line2, cityLine].filter(Boolean) as string[]) : [],
          reference: acct?.customer_reference?.trim() || null,
        },
        charges,
        nextMonth: null,
        // A simple view of what is already owed; the issued invoice lists each unpaid invoice.
        outstanding: { priorBalanceCents: prior, unpaidInvoices: [], lateFees: [], paymentsAndCredits: [] },
        totalAmountDueCents: prior + total,
        showAch: layout.ach && Boolean(company?.ach_instructions?.trim()),
        terms: { netDays, lateFeeSentence: "A late fee of 3% of the unpaid balance applies once an invoice is past its due date, and again every 30 days until paid." },
      }}
    />,
  );
  return new NextResponse(new Uint8Array(buffer), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": 'inline; filename="Invoice preview.pdf"', "Cache-Control": "private, no-store" },
  });
}
