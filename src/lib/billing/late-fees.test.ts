import { describe, expect, it } from "vitest";
import { feeDates, feesToDraft, type FeeTerms } from "./late-fees";

const terms: FeeTerms = { percent_bps: 300, flat_amount_cents: 0, grace_days: 5, frequency: "recurring", recurrence_interval_days: 30, compounding: true };
const inv = { dueDate: "2026-12-31", openCents: 300000, alreadyCharged: 0, unpaidFeesCents: 0 };

describe("late fees", () => {
  it("charges nothing through the five day grace period", () => {
    expect(feeDates("2026-12-31", terms, "2027-01-05")).toEqual([]);
    expect(feesToDraft(inv, terms, "2027-01-05")).toEqual([]);
  });
  it("charges 3% of what is unpaid the day after the grace period ends", () => {
    expect(feesToDraft(inv, terms, "2027-01-06")).toEqual([{ period: 1, feeDate: "2027-01-06", baseCents: 300000, amountCents: 9000 }]);
  });
  it("charges again every 30 days, on the invoice plus its unpaid fees", () => {
    const second = feesToDraft({ ...inv, alreadyCharged: 1, unpaidFeesCents: 9000 }, terms, "2027-02-05");
    expect(second).toEqual([{ period: 2, feeDate: "2027-02-05", baseCents: 309000, amountCents: 9270 }]);
  });
  it("never charges the same period twice", () => {
    expect(feesToDraft({ ...inv, alreadyCharged: 1, unpaidFeesCents: 9000 }, terms, "2027-01-20")).toEqual([]);
  });
  it("catches up in order if the check was missed, compounding as it goes", () => {
    const both = feesToDraft(inv, terms, "2027-02-05");
    expect(both.map((f) => [f.period, f.amountCents])).toEqual([[1, 9000], [2, 9270]]);
  });
  it("works on what is still unpaid after a part payment, rounding half a cent up", () => {
    expect(feesToDraft({ ...inv, openCents: 7222 }, terms, "2027-01-06")[0].amountCents).toBe(217);
    expect(feesToDraft({ ...inv, openCents: 35050 }, terms, "2027-01-06")[0].amountCents).toBe(1052);
  });
  it("charges nothing on a paid invoice, and counts fees QuickBooks already charged", () => {
    expect(feesToDraft({ ...inv, openCents: 0 }, terms, "2027-03-01")).toEqual([]);
    expect(feesToDraft({ ...inv, alreadyCharged: 2 }, terms, "2027-02-05")).toEqual([]);
  });
  it("charges once only when the terms are not recurring", () => {
    expect(feeDates("2026-12-31", { ...terms, frequency: "one_time", recurrence_interval_days: null }, "2027-06-01")).toEqual(["2027-01-06"]);
  });
});
