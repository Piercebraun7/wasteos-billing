import { describe, expect, it } from "vitest";
import { latestPayment, paidInQuickBooks, syncNote } from "./payments";

describe("reading payments from QuickBooks", () => {
  it("works out what is paid from the total and what is still open", () => {
    expect(paidInQuickBooks({ TotalAmt: 2409.72, Balance: 72.22 })).toBe(233750);
    expect(paidInQuickBooks({ TotalAmt: 800, Balance: 800 })).toBe(0);
    expect(paidInQuickBooks({ TotalAmt: 800, Balance: 0 })).toBe(80000);
  });
  it("uses the most recent linked payment for the date and check number", () => {
    const payments = new Map([["a", { Id: "a", TxnDate: "2026-11-02", PaymentRefNum: "100" }], ["b", { Id: "b", TxnDate: "2026-12-04", PaymentRefNum: "205" }]]);
    const inv = { Id: "1", TotalAmt: 10, Balance: 0, LinkedTxn: [{ TxnId: "a", TxnType: "Payment" }, { TxnId: "b", TxnType: "Payment" }, { TxnId: "c", TxnType: "CreditMemo" }] };
    expect(latestPayment(inv, payments)).toMatchObject({ Id: "b", PaymentRefNum: "205" });
    expect(latestPayment({ Id: "2", TotalAmt: 10, Balance: 0 }, payments)).toBeNull();
  });
  it("describes a check in plain words", () => {
    expect(syncNote({ checked: 12, payments: 2, paidCents: 426250, brought: 0, missing: [], problems: [] })).toBe("2 payments recorded, $4,262.50 in total.");
    expect(syncNote({ checked: 12, payments: 0, paidCents: 0, brought: 1, missing: ["2004"], problems: [] })).toBe("No new payments on the 12 unpaid invoices checked. 1 new QuickBooks invoice brought in. No longer in QuickBooks, so left alone here: invoice 2004.");
  });
});
