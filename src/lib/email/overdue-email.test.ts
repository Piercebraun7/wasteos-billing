import { describe, expect, it } from "vitest";
import { overdueEmail } from "./overdue-email";

const base = { propertyName: "Village at Carver Mtn.", balanceCents: 812400, lateFeePercent: "3%", graceDays: 5, replyTo: "invoices@kaizen-waste.com", signoff: "Kaizen Development Team" };

describe("overdue notice", () => {
  it("covers every overdue invoice in one email, with the total", () => {
    const e = overdueEmail({ ...base, feesCharged: true, invoices: [
      { number: 2004, dueDate: "2026-12-31", openCents: 340000, isLateFee: false },
      { number: 2011, dueDate: "2027-01-09", openCents: 70000, isLateFee: false },
      { number: 2030, dueDate: "2027-01-06", openCents: 10200, isLateFee: true },
    ] });
    expect(e.subject).toBe("Past due: 2 Kaizen Waste invoices for Village at Carver Mtn.");
    expect(e.text).toContain("  Invoice 2004: $3,400.00, due Dec 31, 2026");
    expect(e.text).toContain("  Late fee 2030: $102.00, due Jan 6, 2027");
    expect(e.text).toContain("Total past due: $4,202.00");
    expect(e.text).toContain("a late fee of 3% of the unpaid balance has been added to your account");
  });
  it("only says a fee has been added when one has", () => {
    const e = overdueEmail({ ...base, feesCharged: false, invoices: [{ number: 2004, dueDate: "2026-12-31", openCents: 340000, isLateFee: false }] });
    expect(e.subject).toBe("Past due: Kaizen Waste invoice 2004 for Village at Carver Mtn.");
    expect(e.text).toContain("a late fee of 3% of the unpaid balance now applies to this invoice");
    expect(e.text).not.toContain("has been added");
  });
  it("uses no em dashes", () => {
    const e = overdueEmail({ ...base, feesCharged: true, invoices: [{ number: 1, dueDate: "2026-12-31", openCents: 100, isLateFee: false }] });
    expect(e.subject + e.text).not.toMatch(/—|–/);
  });
});
