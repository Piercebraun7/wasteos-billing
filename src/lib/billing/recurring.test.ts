import { describe, expect, it } from "vitest";
import { recurringCharges, recurringDate } from "./drafts";

describe("recurring invoices", () => {
  it("falls on the chosen day each month", () => {
    expect(recurringDate("2026-11-01", 10)).toBe("2026-11-10");
    expect(recurringDate("2027-02-01", 28)).toBe("2027-02-28");
    expect(recurringDate("2026-12-01", 1)).toBe("2026-12-01");
  });
  it("prices its lines with whole cents", () => {
    const c = recurringCharges(
      [{ description: "Scheduled Bulk Waste Service", quantity: "1.5", unit_price_cents: 35000 }, { description: "Discount", quantity: "1", unit_price_cents: -2500 }],
      "2026-11-10",
    );
    expect(c?.total).toBe(50000);
    expect(c?.lines.map((l) => [l.line_type, l.amount_cents])).toEqual([["per_event", 52500], ["adjustment", -2500]]);
  });
  it("refuses a quantity it cannot read", () => {
    expect(recurringCharges([{ description: "x", quantity: "many", unit_price_cents: 100 }], "2026-11-10")).toBeNull();
  });
});
