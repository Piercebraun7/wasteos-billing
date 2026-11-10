import type { ISODate } from "../billing/dates";

/** Everything the invoice PDF shows. Built once, at the moment of generation. */
export type InvoiceDocument = {
  company: { name: string; remittanceAddress: string; achInstructions: string | null; contactLine: string };
  invoice: {
    number: string; // "Draft" until approved
    invoiceDate: ISODate;
    dueDate: ISODate;
    serviceMonth: string; // "November 2026"
    totalCents: number;
    isDraft: boolean;
  };
  billTo: { clientName: string; propertyName: string; addressLines: string[] };
  charges: { description: string; amountCents: number }[];
  outstanding: {
    priorBalanceCents: number;
    unpaidInvoices: { number: string; date: ISODate; remainingCents: number; disputed?: boolean }[];
    lateFees: { description: string; amountCents: number }[];
    paymentsAndCredits: { date: ISODate; reference: string; amountCents: number }[];
  };
  totalAmountDueCents: number;
  showAch: boolean;
  terms: { netDays: number; lateFeeSentence: string };
};

/** One plain sentence describing a late fee template, for the invoice footer. */
export function lateFeeSentence(t: {
  flat_amount_cents: number;
  percent_bps: number;
  grace_days: number;
  frequency: string;
  recurrence_interval_days: number | null;
  compounding: boolean;
} | null): string {
  if (!t) return "";
  const parts: string[] = [];
  if (t.percent_bps > 0) {
    const pct = `${Math.floor(t.percent_bps / 100)}${t.percent_bps % 100 ? `.${String(t.percent_bps % 100).padStart(2, "0").replace(/0$/, "")}` : ""}%`;
    parts.push(`${pct} of the unpaid balance`);
  }
  if (t.flat_amount_cents > 0) parts.push(`$${(t.flat_amount_cents / 100).toFixed(2)}`);
  const when = t.grace_days > 0 ? `${t.grace_days} days after the due date` : "once an invoice is past its due date";
  const repeat =
    t.frequency === "recurring" && t.recurrence_interval_days
      ? `, and again every ${t.recurrence_interval_days} days until paid`
      : "";
  return `A late fee of ${parts.join(" plus ")} applies ${when}${repeat}.`;
}
