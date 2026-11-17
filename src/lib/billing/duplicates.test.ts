import { describe, expect, it } from "vitest";
import { blockingTwin, describeTwin, lookAlikes, possibleDuplicates, type DupeRow } from "./duplicates";

const row = (id: string, over: Partial<DupeRow> = {}): DupeRow => ({
  id, account_id: "a", invoice_number: null, status: "draft", origin: "app", service_category: "bulk",
  service_month: "2026-11-01", invoice_date: "2026-11-10", total_cents: 35000, ...over,
});

describe("duplicates", () => {
  it("flags two bills for the same property, day and amount, each pointing at the other", () => {
    const found = possibleDuplicates([row("1"), row("2", { invoice_number: 2004, status: "sent" })]);
    expect(found.get("1")!.map((r) => r.id)).toEqual(["2"]);
    expect(describeTwin(found.get("1")![0])).toBe("invoice 2004");
    expect(describeTwin(found.get("2")![0])).toBe("another draft");
  });
  it("matches a QuickBooks invoice on the same day for the same amount", () => {
    expect(possibleDuplicates([row("1"), row("2", { origin: "quickbooks_import", status: "sent", invoice_number: 1204 })]).size).toBe(2);
  });
  it("does not flag a different amount, property or day", () => {
    expect(possibleDuplicates([row("1"), row("2", { total_cents: 70000 })]).size).toBe(0);
    expect(possibleDuplicates([row("1"), row("2", { account_id: "b" })]).size).toBe(0);
    expect(possibleDuplicates([row("1"), row("2", { invoice_date: "2026-11-17" })]).size).toBe(0);
  });
  it("ignores voided invoices, so a reissue is not flagged against the one it replaced", () => {
    expect(possibleDuplicates([row("1"), row("2", { status: "void" })]).size).toBe(0);
  });
});

describe("look-alikes", () => {
  it("points out a second bill in the same month for the same amount on another day, without calling it a duplicate", () => {
    const rows = [row("1"), row("2", { invoice_date: "2026-11-17" })];
    expect(lookAlikes(rows).get("1")!.map((r) => r.id)).toEqual(["2"]);
    expect(possibleDuplicates(rows).size).toBe(0);
  });
  it("leaves true duplicates to the duplicate rule", () => {
    expect(lookAlikes([row("1"), row("2")]).size).toBe(0);
  });
});

describe("only one of a duplicate pair can be approved", () => {
  it("lets the first draft through and stops the second once the first is issued", () => {
    const first = row("1");
    const second = row("2");
    expect(blockingTwin(first, [first, second])).toBeNull();
    const issued = { ...first, status: "approved", invoice_number: 2010 };
    expect(blockingTwin(second, [issued, second])?.invoice_number).toBe(2010);
  });
  it("is not stopped by a voided twin", () => {
    expect(blockingTwin(row("2"), [row("1", { status: "void", invoice_number: 2010 }), row("2")])).toBeNull();
  });
});
