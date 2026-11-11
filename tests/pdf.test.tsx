import { writeFileSync } from "node:fs";
import { renderToBuffer } from "@react-pdf/renderer";
import { expect, it } from "vitest";
import { lateFeeSentence } from "@/lib/pdf/invoice-data";
import { InvoicePdf } from "@/lib/pdf/invoice-pdf";

it("renders an invoice PDF", async () => {
  const sentence = lateFeeSentence({ flat_amount_cents: 0, percent_bps: 300, grace_days: 0, frequency: "recurring", recurrence_interval_days: 30, compounding: false });
  expect(sentence).toBe("A late fee of 3% of the unpaid balance applies once an invoice is past its due date, and again every 30 days until paid.");
  const buf = await renderToBuffer(<InvoicePdf doc={{
    company: { name: "Kaizen Waste, LLC", remittanceAddress: "3459 E Pasadena Ave, Phoenix, AZ 85018", achInstructions: "Entered in Settings", contactLine: "Questions: reply to this email." },
    invoice: { number: "1219", invoiceDate: "2026-11-30", dueDate: "2026-12-30", serviceMonth: "November 2026", totalCents: 247500, isDraft: false, memo: null },
    billTo: { clientName: "Stellar Residential", propertyName: "Village at Liberty Farms", addressLines: ["5801 S. 51st Ave", "Laveen, AZ 85339"] },
    charges: [
      { title: "Valet service", detail: "November 2026 \u00b7 Nov 1 to Nov 15 (15 of 30 days)", units: "100", rateCents: 1250, amountCents: 62500 },
      { title: "Valet service", detail: "November 2026 \u00b7 Nov 16 to Nov 30 (15 of 30 days)", units: "240", rateCents: 1250, amountCents: 150000 },
      { title: "Bulk pickup", detail: "November 2026 \u00b7 Nov 14", units: "1", rateCents: 35000, amountCents: 35000 },
    ],
    nextMonth: { label: "December 2026", amountCents: 300000 },
    outstanding: {
      priorBalanceCents: 191838,
      unpaidInvoices: [{ number: "1190", date: "2026-10-31", remainingCents: 186250 }],
      lateFees: [{ description: "Late fee on invoice 1190", amountCents: 5588 }],
      paymentsAndCredits: [{ date: "2026-11-12", reference: "Check 5501", amountCents: -186250 }],
    },
    totalAmountDueCents: 439338, showAch: true, terms: { netDays: 30, lateFeeSentence: sentence },
  }} />);
  expect(buf.subarray(0, 4).toString()).toBe("%PDF");
  if (process.env.PDF_OUT) writeFileSync(process.env.PDF_OUT, buf);
});
