import { describe, expect, it } from "vitest";
import { itemFor, qboLine } from "./push";

const line = (quantity: number, unit: number, amount: number) => ({ description: "Valet service", quantity, unit_price_cents: unit, amount_cents: amount, sort_order: 0, line_type: "valet" });

describe("QuickBooks invoice lines", () => {
  it("keeps units and rate when they multiply out exactly", () => {
    expect(qboLine(line(240, 1250, 300000), "7")).toMatchObject({ Amount: 3000, SalesItemLineDetail: { ItemRef: { value: "7" }, Qty: 240, UnitPrice: 12.5 } });
  });
  it("sends a prorated line as one unit at its amount, so QuickBooks cannot change the total", () => {
    expect(qboLine(line(240, 1250, 145161), "7")).toMatchObject({ Amount: 1451.61, SalesItemLineDetail: { Qty: 1, UnitPrice: 1451.61 } });
  });
  it("carries a resident refund as a negative line", () => {
    expect(qboLine(line(1, -2500, -2500), "7")).toMatchObject({ Amount: -25, SalesItemLineDetail: { Qty: 1, UnitPrice: -25 } });
  });
  it("picks the product for the service, else the catch-all, else none", () => {
    expect(itemFor({ valet: "1", other: "9" }, "valet")).toBe("1");
    expect(itemFor({ valet: "1", other: "9" }, "bulk")).toBe("9");
    expect(itemFor({ valet: "1" }, "bulk")).toBeNull();
  });
});
