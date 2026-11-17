import { describe, expect, it } from "vitest";
import { describeTwin, possibleDuplicates, type DupeRow } from "./duplicates";

const row = (id: string, over: Partial<DupeRow> = {}): DupeRow => ({
  id, account_id: "a", invoice_number: null, status: "draft", origin: "app", service_category: "bulk",
  service_month: "2026-11-01", invoice_date: "2026-11-10", total_cents: 35000, ...over,
});

describe("possible duplicates", () => {
  it("flags two bills for the same property, day and amount, each pointing at the other", () => {
    const found = possibleDuplicates([row("1"), row("2", { invoice_number: 2004, status: "sent" })]);
    expect(found.get("1")!.map((r) => r.id)).toEqual(["2"]);
    expect(describeTwin(found.get("1")![0])).toBe("invoice 2004");
    expect(describeTwin(found.get("2")![0])).toBe("another draft");
  });
  it("flags the same service, month and amount even on different days", () => {
    expect(possibleDuplicates([row("1"), row("2", { invoice_date: "2026-11-17" })]).size).toBe(2);
  });
  it("does not flag a different amount, a different property, or a second pickup on another day for another amount", () => {
    expect(possibleDuplicates([row("1"), row("2", { total_cents: 70000 })]).size).toBe(0);
    expect(possibleDuplicates([row("1"), row("2", { account_id: "b" })]).size).toBe(0);
  });
  it("ignores voided invoices, so a reissue is not flagged against the one it replaced", () => {
    expect(possibleDuplicates([row("1"), row("2", { status: "void" })]).size).toBe(0);
  });
  it("does not match a QuickBooks invoice by month alone, only by the same day and amount", () => {
    const qb = { origin: "quickbooks_import", status: "sent", invoice_number: 1204 };
    expect(possibleDuplicates([row("1", { invoice_date: "2026-12-01" }), row("2", { ...qb, invoice_date: "2026-11-02" })]).size).toBe(0);
    expect(possibleDuplicates([row("1"), row("2", qb)]).size).toBe(2);
  });
});
