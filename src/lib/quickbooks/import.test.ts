import { describe, expect, it } from "vitest";
import { serviceOf, toImportRow, type QboInvoice } from "./import";

const line = (item: string, description: string, amount: number, qty: number, unit: number) => ({
  DetailType: "SalesItemLineDetail", Amount: amount, Description: description, SalesItemLineDetail: { Qty: qty, UnitPrice: unit, ItemRef: { name: item } },
});
const invoice = (over: Partial<QboInvoice> = {}): QboInvoice => ({
  Id: "1273", DocNumber: "1159", TxnDate: "2026-09-01", DueDate: "2026-10-01", TotalAmt: 2409.72, Balance: 72.22, CustomerRef: { value: "53", name: "Village at the BLVD" },
  Line: [
    line("Monthly Valet Waste Service", "August Servicing", 2337.5, 1, 2337.5),
    line("Late Fee", "3% - Applied on Oct 7, 2026", 70.12, 0, 0),
    line("Late Fee", "3% - Applied on Nov 7, 2026", 2.1, 0, 0),
    { DetailType: "SubTotalLineDetail", Amount: 2409.72 },
  ],
  ...over,
});

describe("reading an open QuickBooks invoice", () => {
  it("keeps the number, dates, total and what is still open, in cents", () => {
    expect(toImportRow(invoice(), "acct")).toMatchObject({ number: 1159, qbo_id: "1273", account_id: "acct", invoice_date: "2026-09-01", due_date: "2026-10-01", total_cents: 240972, open_cents: 7222, service: "valet" });
  });
  it("carries late fees as late fee lines, and the lines add up to the total", () => {
    const row = toImportRow(invoice(), "acct");
    expect(row.lines.map((l) => l.line_type)).toEqual(["flat", "late_fee", "late_fee"]);
    expect(row.lines[1]).toMatchObject({ quantity: 1, unit_price_cents: 7012, amount_cents: 7012 });
    expect(row.lines.reduce((s, l) => s + l.amount_cents, 0)).toBe(240972);
  });
  it("keeps units and rate when they multiply out, and a discount as a negative line", () => {
    const row = toImportRow(invoice({ TotalAmt: 675, Balance: 675, Line: [line("Bulk:Scheduled Bulk Waste Service (Once Monthly)", "Two full loads", 700, 2, 350), line("Resident Satisfaction Discount", "", -25, 1, -25)] }), "acct");
    expect(row.lines[0]).toMatchObject({ quantity: 2, unit_price_cents: 35000, amount_cents: 70000, line_type: "flat" });
    expect(row.lines[1]).toMatchObject({ amount_cents: -2500, line_type: "adjustment" });
    expect(row.service).toBe("bulk");
  });
  it("adds one line for anything outside the item lines, so the total still matches QuickBooks", () => {
    const row = toImportRow(invoice({ TotalAmt: 108.25, Balance: 108.25, Line: [line("Bulk Trash Service", "Trash out", 100, 1, 100)] }), "acct");
    expect(row.lines.at(-1)).toMatchObject({ amount_cents: 825, description: "Other charges on the QuickBooks invoice" });
  });
  it("sorts products into services by name", () => {
    expect(serviceOf(["Late Fee", "Trash Room Management"])).toBe("trash_room");
    expect(serviceOf(["Lease-Up Valet Waste Service"])).toBe("valet");
    expect(serviceOf(["Replacement Can"])).toBe("other");
  });
});
