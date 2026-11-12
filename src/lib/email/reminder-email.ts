import { formatDate } from "../format";
import { formatCents } from "../money";

/** The reminder for an invoice that reached its due date unpaid. */
export function reminderEmail(input: {
  propertyName: string;
  invoiceNumber: number;
  remainingCents: number;
  dueDate: string;
  balanceCents: number;
  replyTo: string | null;
  signoff: string;
}): { subject: string; text: string } {
  const { invoiceNumber: n } = input;
  return {
    subject: `Reminder: Kaizen Waste invoice ${n} for ${input.propertyName} was due ${formatDate(input.dueDate)}`,
    text: [
      "Hello,",
      "",
      `This is a friendly reminder that invoice ${n} for ${input.propertyName} was due on ${formatDate(input.dueDate)}, and we have not yet recorded a payment for it.`,
      "",
      `Amount due on invoice ${n}: ${formatCents(input.remainingCents)}`,
      `Total account balance: ${formatCents(input.balanceCents)}`,
      "",
      "A copy of the invoice is attached. Checks can be mailed to Kaizen Waste, LLC, 3459 E Pasadena Ave, Phoenix, AZ 85018.",
      "",
      "If payment is already on its way, thank you, and please disregard this note.",
      input.replyTo ? `Questions: reply to this email or write to ${input.replyTo}.` : "Questions: reply to this email.",
      "",
      "Thank you,",
      input.signoff,
    ].join("\n"),
  };
}
