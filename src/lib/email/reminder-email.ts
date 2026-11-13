import { formatDate } from "../format";
import { formatCents } from "../money";

/**
 * The reminder for an unpaid invoice. Past its due date it says so; before the
 * due date it reads as a courtesy note. An invoice that was first sent from
 * QuickBooks goes out without an attachment, since the customer already has
 * the original and a redrawn copy could be mistaken for a new invoice.
 */
export function reminderEmail(input: {
  propertyName: string;
  invoiceNumber: number;
  remainingCents: number;
  dueDate: string;
  balanceCents: number;
  replyTo: string | null;
  signoff: string;
  /** Today in Phoenix. Left out, the invoice is treated as past due. */
  today?: string;
  /** The date the invoice was first sent, when it came from QuickBooks. */
  sentFromQuickBooksOn?: string | null;
}): { subject: string; text: string } {
  const { invoiceNumber: n } = input;
  const upcoming = Boolean(input.today && input.dueDate > input.today);
  const when = upcoming ? `is due ${formatDate(input.dueDate)}` : `was due ${formatDate(input.dueDate)}`;
  return {
    subject: `Reminder: Kaizen Waste invoice ${n} for ${input.propertyName} ${when}`,
    text: [
      "Hello,",
      "",
      upcoming
        ? `This is a friendly reminder that invoice ${n} for ${input.propertyName} is due on ${formatDate(input.dueDate)}.`
        : `This is a friendly reminder that invoice ${n} for ${input.propertyName} was due on ${formatDate(input.dueDate)}, and we have not yet recorded payment in full for it.`,
      "",
      `Amount due on invoice ${n}: ${formatCents(input.remainingCents)}`,
      `Total account balance: ${formatCents(input.balanceCents)}`,
      "",
      `${input.sentFromQuickBooksOn ? `This invoice was sent to you on ${formatDate(input.sentFromQuickBooksOn)}. Reply to this email if you would like another copy.` : "A copy of the invoice is attached."} Checks can be mailed to Kaizen Waste, LLC, 3459 E Pasadena Ave, Phoenix, AZ 85018.`,
      "",
      "If payment is already on its way, thank you, and please disregard this note.",
      input.replyTo ? `Questions: reply to this email or write to ${input.replyTo}.` : "Questions: reply to this email.",
      "",
      "Thank you,",
      input.signoff,
    ].join("\n"),
  };
}
