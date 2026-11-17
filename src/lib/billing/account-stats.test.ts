import { describe, expect, it } from "vitest";
import { accountStats, type StatInvoice } from "./account-stats";

const inv = (id: string, over: Partial<StatInvoice> = {}): StatInvoice => ({
  id, invoice_number: Number(id), status: "sent", invoice_date: "2026-10-01", due_date: "2026-10-31", total_cents: 100000, service_category: "valet", kind: "scheduled", ...over,
});
const today = "2026-11-17";

describe("account figures", () => {
  it("adds up what is open and what is overdue, by service, including late fees inside an invoice", () => {
    const s = accountStats(
      [inv("1"), inv("2", { service_category: "bulk", total_cents: 35000, due_date: "2026-12-10", invoice_date: "2026-11-10" }), inv("3", { total_cents: 50000 })],
      [{ invoice_id: "3", amount_cents: 20000, date: "2026-10-20" }],
      [],
      today,
    );
    expect(s.outstandingCents).toBe(100000 + 35000 + 30000);
    expect(s.overdueCents).toBe(100000 + 30000);
    expect(s.openByService).toEqual({ valet: 130000, bulk: 35000 });
    expect(s.invoices.find((i) => i.id === "3")!.state).toBe("Overdue");
    expect(s.invoices.find((i) => i.id === "2")!.state).toBe("Open");
  });
  it("counts a credit against an invoice, and never counts drafts or voided invoices", () => {
    const s = accountStats(
      [inv("1"), inv("2", { status: "draft" }), inv("3", { status: "void" })],
      [],
      [{ invoice_id: "1", amount_cents: 25000, date: "2026-10-15" }],
      today,
    );
    expect(s.outstandingCents).toBe(75000);
    expect(s.invoices.map((i) => i.id).sort()).toEqual(["1", "3"]);
    expect(s.billed12Cents).toBe(100000);
  });
  it("works out the share paid on time from invoices paid in full", () => {
    const s = accountStats(
      [inv("1"), inv("2"), inv("3")],
      [
        { invoice_id: "1", amount_cents: 100000, date: "2026-10-30" },
        { invoice_id: "2", amount_cents: 100000, date: "2026-11-05" },
      ],
      [],
      today,
    );
    expect(s.paidInFull).toBe(2);
    expect(s.onTimePercent).toBe(50);
    expect(s.paid12Cents).toBe(200000);
    expect(s.lastPayment).toEqual({ date: "2026-11-05", amountCents: 100000 });
  });
  it("says nothing about on-time payment when nothing has been paid in full", () => {
    expect(accountStats([inv("1")], [], [], today).onTimePercent).toBeNull();
  });
  it("leaves out of the last 12 months anything older", () => {
    const s = accountStats([inv("1", { invoice_date: "2025-10-01", due_date: "2025-10-31" })], [{ invoice_id: "1", amount_cents: 100000, date: "2025-10-20" }], [], today);
    expect(s.billed12Cents).toBe(0);
    expect(s.paid12Cents).toBe(0);
  });
});
