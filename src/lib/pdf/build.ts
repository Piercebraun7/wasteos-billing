import type { SupabaseClient } from "@supabase/supabase-js";
import { monthLabel } from "../billing/dates";
import type { BillingModel, Phase } from "../billing/invoice-math";
import { nextMonth, scheduleCell } from "../billing/schedule";
import { lateFeeSentence, type InvoiceDocument } from "./invoice-data";

type Entry = { entry_date: string; entry_type: string; amount_cents: number; source_table: string; source_id: string; description: string | null };

/** Gathers everything the invoice PDF shows, reading balances from the ledger as it stands right now. */
export async function buildInvoiceDocument(supabase: SupabaseClient, invoiceId: string): Promise<InvoiceDocument | null> {
  const { data: invoice } = await supabase
    .from("invoices")
    .select(
      `*, lines:invoice_lines!invoice_lines_invoice_id_fkey(*),
       account:billing_accounts(id, property:properties(*), customer:customers(name, is_ach_payer),
         contracts(status, net_days, created_at, billing_model, start_date, end_date, phases:contract_phases(*), late_fee_template:late_fee_templates(*)))`,
    )
    .eq("id", invoiceId)
    .maybeSingle();
  if (!invoice) return null;

  const accountId = invoice.account.id as string;
  const [settings, ledger, others, applications, credits, payments, disputes] = await Promise.all([
    supabase.from("app_settings").select("*").maybeSingle(),
    supabase.from("ledger_entries").select("*").eq("account_id", accountId),
    supabase.from("invoices").select("id, invoice_number, invoice_date, total_cents, status").eq("account_id", accountId).neq("id", invoiceId).in("status", ["approved", "sent", "partially_paid", "paid"]),
    supabase.from("payment_applications").select("invoice_id, amount_cents, payment_id").eq("account_id", accountId),
    supabase.from("credit_memos").select("id, invoice_id, amount_cents, reason").eq("account_id", accountId),
    supabase.from("payments").select("id, method, check_number"),
    supabase.from("disputes").select("invoice_id").eq("account_id", accountId).eq("status", "open"),
  ]);

  const entries = ((ledger.data ?? []) as Entry[]).map((e) => ({ ...e, amount_cents: Number(e.amount_cents) }));
  const earlier = entries.filter((e) => !(e.source_table === "invoices" && e.source_id === invoiceId));
  const priorTotal = earlier.reduce((sum, e) => sum + e.amount_cents, 0);

  // "Since the last invoice" means after the most recent earlier invoice date.
  const earlierInvoices = (others.data ?? []).filter((o) => o.invoice_date <= invoice.invoice_date);
  const lastInvoiceDate = earlierInvoices.map((o) => o.invoice_date as string).sort().at(-1) ?? "0000-00-00";
  const since = earlier.filter((e) => e.entry_date > lastInvoiceDate);

  const lateFees = since
    .filter((e) => e.entry_type === "late_fee" || e.entry_type === "late_fee_waiver")
    .map((e) => ({ description: e.description ?? (e.entry_type === "late_fee" ? "Late fee" : "Late fee waived"), amountCents: e.amount_cents }));
  const lateFeeTotal = lateFees.reduce((sum, f) => sum + f.amountCents, 0);

  const paymentById = new Map((payments.data ?? []).map((p) => [p.id as string, p]));
  const creditById = new Map((credits.data ?? []).map((c) => [c.id as string, c]));
  const paymentsAndCredits = since
    .filter((e) => e.entry_type === "payment" || e.entry_type === "credit")
    .sort((a, b) => a.entry_date.localeCompare(b.entry_date))
    .map((e) => {
      const p = paymentById.get(e.source_id);
      const c = creditById.get(e.source_id);
      const reference = p
        ? p.method === "check" ? `Check ${p.check_number ?? ""}`.trim() : p.method === "ach" ? "ACH payment" : "Payment"
        : c ? `Credit: ${c.reason}` : (e.description ?? "Credit");
      return { date: e.entry_date, reference, amountCents: e.amount_cents };
    });

  const disputed = new Set((disputes.data ?? []).map((d) => d.invoice_id as string));
  const unpaidInvoices = (others.data ?? [])
    .map((o) => {
      const paid = (applications.data ?? []).filter((a) => a.invoice_id === o.id).reduce((s, a) => s + Number(a.amount_cents), 0);
      const credited = (credits.data ?? []).filter((c) => c.invoice_id === o.id).reduce((s, c) => s + Number(c.amount_cents), 0);
      return { number: String(o.invoice_number ?? ""), date: o.invoice_date as string, remainingCents: Number(o.total_cents) - paid - credited, disputed: disputed.has(o.id) };
    })
    .filter((u) => u.remainingCents > 0)
    .sort((a, b) => a.date.localeCompare(b.date));

  type ContractRow = {
    status: string; net_days: number; created_at: string; billing_model: BillingModel;
    start_date: string | null; end_date: string | null; phases: Phase[];
    late_fee_template: Parameters<typeof lateFeeSentence>[0];
  };
  const contracts = (invoice.account.contracts ?? []) as ContractRow[];
  const contract = contracts.find((c) => c.status === "active") ?? [...contracts].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  const property = invoice.account.property;
  const cityLine = [property.city, [property.state, property.postal_code].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const company = settings.data;
  const total = Number(invoice.total_cents);
  const serviceLabel = monthLabel(invoice.service_month);
  const following = contract
    ? scheduleCell({ model: contract.billing_model, phases: contract.phases ?? [], month: nextMonth(invoice.service_month), contractStart: contract.start_date, contractEnd: contract.end_date })
    : null;

  return {
    company: {
      name: company?.company_name ?? "Kaizen Waste, LLC",
      remittanceAddress: company?.remittance_address ?? "3459 E Pasadena Ave, Phoenix, AZ 85018",
      achInstructions: company?.ach_instructions ?? null,
      contactLine: company?.email_reply_to ? `Questions: ${company.email_reply_to}.` : "Questions: reply to the email this invoice came with.",
    },
    invoice: {
      number: invoice.invoice_number ? String(invoice.invoice_number) : "Draft",
      invoiceDate: invoice.invoice_date,
      dueDate: invoice.due_date,
      serviceMonth: monthLabel(invoice.service_month),
      totalCents: total,
      isDraft: invoice.status === "draft",
    },
    billTo: {
      clientName: invoice.account.customer.name,
      propertyName: property.name,
      addressLines: [property.address_line1, property.address_line2, cityLine].filter(Boolean),
    },
    charges: [...(invoice.lines as LineRow[])].sort((a, b) => a.sort_order - b.sort_order).map((l) => chargeRow(l, serviceLabel)),
    nextMonth: following && following.amountCents !== null ? { label: monthLabel(following.month), amountCents: following.amountCents } : null,
    outstanding: { priorBalanceCents: priorTotal - lateFeeTotal, unpaidInvoices, lateFees, paymentsAndCredits },
    totalAmountDueCents: priorTotal + total,
    showAch: Boolean(invoice.account.customer.is_ach_payer),
    terms: { netDays: contract?.net_days ?? 30, lateFeeSentence: lateFeeSentence(contract?.late_fee_template ?? null) },
  };
}

type LineRow = {
  description: string; amount_cents: number; sort_order: number; line_type: string;
  quantity: number; unit_price_cents: number;
};

/** Splits a stored line into the columns the invoice shows. */
function chargeRow(l: LineRow, serviceLabel: string): InvoiceDocument["charges"][number] {
  const [title, ...rest] = l.description.split(", ");
  // The unit count and rate get their own columns, so drop them from the text.
  const extra = rest.filter((part) => !/^\d+ units at \$[\d,.]+$/.test(part) && !/^\$[\d,.]+ per month$/.test(part));
  const perUnit = l.line_type === "valet" || l.line_type === "per_event";
  return {
    title,
    detail: [serviceLabel, ...extra].join(" \u00b7 "),
    units: perUnit ? String(Number(l.quantity)) : "",
    rateCents: l.line_type === "tax" ? null : Number(l.unit_price_cents),
    amountCents: Number(l.amount_cents),
  };
}

/** Where an approved invoice's PDF lives in the private bucket. */
export const pdfPath = (accountId: string, invoiceId: string) => `${accountId}/${invoiceId}.pdf`;
