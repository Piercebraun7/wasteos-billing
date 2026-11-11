import { monthLabel } from "../billing/dates";
import { formatDate } from "../format";
import { formatCents } from "../money";

export type EmailInvoice = { number: number; totalCents: number; dueDate: string; serviceMonth: string; kind: string };

/** Subject and plain body for one email carrying one or more invoices for a property. */
export function invoiceEmail(input: { propertyName: string; invoices: EmailInvoice[]; balanceCents: number; replyTo: string | null }) {
  const { propertyName, invoices, balanceCents } = input;
  const sorted = [...invoices].sort((a, b) => a.number - b.number);
  const numbers = sorted.map((i) => i.number).join(", ");
  const subject =
    sorted.length === 1
      ? `Kaizen Waste Invoice ${numbers}: ${propertyName}, ${monthLabel(sorted[0].serviceMonth)}`
      : `Kaizen Waste Invoices ${numbers}: ${propertyName}`;
  const lines = sorted.map((i) => `Invoice ${i.number}: ${formatCents(i.totalCents)}, due ${formatDate(i.dueDate)}`);
  const text = [
    "Hello,",
    "",
    sorted.length === 1
      ? `Attached is invoice ${numbers} from Kaizen Waste for ${propertyName}.`
      : `Attached are ${sorted.length} invoices from Kaizen Waste for ${propertyName}.`,
    "",
    ...lines,
    "",
    `Total account balance: ${formatCents(balanceCents)}`,
    "",
    "Checks can be mailed to Kaizen Waste, LLC, 3459 E Pasadena Ave, Phoenix, AZ 85018.",
    input.replyTo ? `Questions: reply to this email or write to ${input.replyTo}.` : "Questions: reply to this email.",
    "",
    "Thank you,",
    "Kaizen Waste",
  ].join("\n");
  return { subject, text };
}
