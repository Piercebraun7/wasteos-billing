import { formatDate } from "../format";
import { formatCents } from "../money";

export type OverdueInvoice = { number: number; dueDate: string; openCents: number; isLateFee: boolean };

/**
 * One notice per property covering every invoice past its due date and grace
 * period. It states plainly what is overdue and that the late fee applies,
 * and stays courteous. The late fee sentence only says a fee "has been added"
 * when one really has; otherwise it says the fee applies.
 */
export function overdueEmail(input: {
  propertyName: string;
  invoices: OverdueInvoice[];
  balanceCents: number;
  lateFeePercent: string; // "3%"
  feesCharged: boolean;
  graceDays: number;
  replyTo: string | null;
  signoff: string;
}): { subject: string; text: string } {
  const bills = input.invoices.filter((i) => !i.isLateFee);
  const many = bills.length !== 1;
  const overdueTotal = input.invoices.reduce((s, i) => s + i.openCents, 0);
  const list = input.invoices.map((i) => `  ${i.isLateFee ? "Late fee" : "Invoice"} ${i.number}: ${formatCents(i.openCents)}, due ${formatDate(i.dueDate)}`);
  const fee = input.feesCharged
    ? `Please be advised that, under our service agreement, a late fee of ${input.lateFeePercent} of the unpaid balance has been added to your account, and a further ${input.lateFeePercent} applies for each 30 days ${many ? "these invoices remain" : "this invoice remains"} unpaid.`
    : `Please be advised that, under our service agreement, a late fee of ${input.lateFeePercent} of the unpaid balance now applies to ${many ? "these invoices" : "this invoice"}, and again for each 30 days ${many ? "they remain" : "it remains"} unpaid.`;
  return {
    subject: `Past due: ${many ? `${bills.length} Kaizen Waste invoices` : `Kaizen Waste invoice ${bills[0]?.number ?? input.invoices[0].number}`} for ${input.propertyName}`,
    text: [
      "Hello,",
      "",
      `We are writing to let you know that the following ${input.invoices.length === 1 ? "item" : "items"} for ${input.propertyName} ${input.invoices.length === 1 ? "is" : "are"} now past due:`,
      "",
      ...list,
      "",
      `Total past due: ${formatCents(overdueTotal)}`,
      `Total account balance: ${formatCents(input.balanceCents)}`,
      "",
      fee,
      "",
      "Payment can be mailed to Kaizen Waste, LLC, 3459 E Pasadena Ave, Phoenix, AZ 85018. Please reference the invoice number with your payment.",
      "",
      "If payment has already been sent, thank you, and please disregard this notice. If there is a question about any of these charges, or anything we can do to help get this resolved, we are glad to work with you.",
      input.replyTo ? `You can reply to this email or write to ${input.replyTo}.` : "You can reply to this email.",
      "",
      "Thank you,",
      input.signoff,
    ].join("\n"),
  };
}
