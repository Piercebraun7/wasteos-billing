import { describe, expect, it } from "vitest";
import { invoiceEmail } from "./invoice-email";

describe("invoice email", () => {
  const one = { number: 2000, totalCents: 186250, dueDate: "2026-12-30", serviceMonth: "2026-11-01", kind: "scheduled" };
  it("one invoice: number, property, and service month in the subject", () => {
    const e = invoiceEmail({ propertyName: "Village at Liberty Farms", invoices: [one], balanceCents: 216250, replyTo: "pierce@example.com" });
    expect(e.subject).toBe("Kaizen Waste Invoice 2000: Village at Liberty Farms, November 2026");
    expect(e.text).toContain("Invoice 2000: $1,862.50, due Dec 30, 2026");
    expect(e.text).toContain("Total account balance: $2,162.50");
    expect(e.text).not.toContain("—");
  });
  it("several invoices go in one email, in number order", () => {
    const e = invoiceEmail({ propertyName: "Carver", invoices: [{ ...one, number: 2004, totalCents: 52500 }, { ...one, number: 2001 }], balanceCents: 238750, replyTo: null });
    expect(e.subject).toBe("Kaizen Waste Invoices 2001, 2004: Carver");
    expect(e.text.indexOf("Invoice 2001")).toBeLessThan(e.text.indexOf("Invoice 2004"));
    expect(e.text).toContain("Attached are 2 invoices");
  });
});
