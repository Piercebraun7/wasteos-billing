import { describe, expect, it } from "vitest";
import { scheduleCell } from "../billing/schedule";
import { parseContractText } from "./parse";
import { flatPhase, rampMonthStart, rampPhases, termEnd } from "./ramp";

// Shaped like the text a real Kaizen agreement yields, with invented details.
const VALET = `Property Address: 100 Example Ave. City: Phoenix State: AZ Zip: 85000
Billing Address: 100 Example Ave. City: Phoenix State: AZ Zip: 85000
Summary of Material Terms
Term: 6 Years, Commencing June 1, 2025 Total Monthly Service Fee: $3692.40
Early Termination Fee: 3 months Service Fee
Initial Number of Containers: 272
within fifteen (15) days of
receipt of such invoice (the "Payment Due Date"), Customer shall pay
additional late fee payment of three percent (3%) of the outstanding Service Fee.
Total # of
Containers:
Service Fee Per Month Per
Container
Subtotal Additional
Charges/Sales
Tax:
Total:
272 $12.5 $3400.00 State: 8.6%​
*Subject to
Change
$3692.40
APPENDIX B Estimated Lease-Up Schedule (Not Including Applicable Taxes)
Occupancy Price Per Unit/Month Service Fee Total
Month 1 (Free) $12.50 $0
Month 2 (Free) $12.50 $0
Month 3 (Free) $12.50 $0
Month 4 (10 Units) $12.50 $125
Month 5 (20 Units) $12.50 $250
Month 11 (80 Units) $12.50 $1000
Month 12+ (Full Service Fee) $12.50 $3400.00`;

const FLAT = `Property Address: 1 Sample Rd | City: Phoenix | State: AZ Zip: 85001
Billing Address: PO Box 1 City: Logan State: UT Zip: 84000
Term: 1 Year, Commencing June 1, 2026 Total Monthly Service Fee: $1,800.00Docusign Envelope ID: X
Initial Number of Containers: N/A
within fifteen (15) days of receipt of such invoice
late fee payment of three percent (3%) of the outstanding Service Fee
Total # of Days
Moved:
Service Fee Per Move Subtotal Additional
Charges/Sales
Tax:
Total:
6 $75 $1,800.00 N/A $1,800.00`;

describe("reading a contract", () => {
  it("reads a per-unit agreement with a lease-up schedule", () => {
    const t = parseContractText(VALET);
    expect(t).toMatchObject({
      kind: "per_unit", termYears: 6, commencement: "2025-06-01", unitCount: 272, ratePerUnitCents: 1250,
      monthlyFeeCents: 340000, lateFeePercent: "3", paymentDays: 15, taxPercent: "8.6",
      billingAddress: "100 Example Ave., Phoenix, AZ, 85000",
    });
    expect(t.ramp).toHaveLength(7);
    expect(t.ramp[0]).toEqual({ month: 1, label: "Free", free: true, units: null, totalCents: 0 });
    expect(t.ramp[3]).toEqual({ month: 4, label: "10 Units", free: false, units: 10, totalCents: 12500 });
    expect(t.ramp[6]).toEqual({ month: 12, label: "Full Service Fee", free: false, units: null, totalCents: 340000 });
  });

  it("reads a flat agreement and takes the pre-tax fee", () => {
    const t = parseContractText(FLAT);
    expect(t).toMatchObject({
      kind: "flat", termYears: 1, commencement: "2026-06-01", unitCount: null, ratePerUnitCents: null,
      monthlyFeeCents: 180000, taxPercent: null, ramp: [],
    });
  });

  it("returns nothing rather than guessing when the text is not an agreement", () => {
    const t = parseContractText("Lunch menu. Soup $4.50.");
    expect(t).toMatchObject({ kind: "unknown", termYears: null, unitCount: null, monthlyFeeCents: null, ramp: [] });
  });
});

describe("building phases from the schedule", () => {
  const steps = parseContractText(VALET).ramp;

  it("calendar months: month 1 starts on the service date, later months on the 1st", () => {
    expect(rampMonthStart("2025-07-20", 1, "calendar")).toBe("2025-07-20");
    expect(rampMonthStart("2025-07-20", 4, "calendar")).toBe("2025-10-01");
    expect(rampMonthStart("2025-07-20", 12, "calendar")).toBe("2026-06-01");
    expect(rampMonthStart("2025-11-12", 3, "calendar")).toBe("2026-01-01");
  });

  it("anniversary months: every month starts on the service day, clamped to short months", () => {
    expect(rampMonthStart("2025-07-20", 4, "anniversary")).toBe("2025-10-20");
    expect(rampMonthStart("2025-01-31", 2, "anniversary")).toBe("2025-02-28");
    expect(rampMonthStart("2025-11-12", 3, "anniversary")).toBe("2026-01-12");
  });

  it("merges the free months and steps up to the full rate", () => {
    const phases = rampPhases({ steps, start: "2025-07-20", align: "calendar", fullUnits: 272, rateCents: 1250 });
    expect(phases.map((p) => [p.label, p.effective_start, p.billable_units, p.rate_per_unit_cents])).toEqual([
      ["Free months", "2025-07-20", 272, 0],
      ["Lease-up month 4", "2025-10-01", 10, 1250],
      ["Lease-up month 5", "2025-11-01", 20, 1250],
      ["Lease-up month 11", "2026-05-01", 80, 1250],
      ["Full rate", "2026-06-01", 272, 1250],
    ]);
  });

  it("the schedule bills what the contract's table says", () => {
    const phases = rampPhases({ steps, start: "2025-07-20", align: "calendar", fullUnits: 272, rateCents: 1250 }).map((p, i) => ({ ...p, id: String(i) }));
    const cell = (month: string) => scheduleCell({ model: "per_unit_valet", phases, month, contractStart: "2025-07-20" });
    expect(cell("2025-06-01").amountCents).toBeNull();
    expect(cell("2025-07-01")).toMatchObject({ amountCents: 0, free: true, partial: true });
    expect(cell("2025-09-01")).toMatchObject({ amountCents: 0, free: true, partial: false });
    expect(cell("2025-10-01")).toMatchObject({ amountCents: 12500, units: 10, phaseStarts: true });
    expect(cell("2025-11-01").amountCents).toBe(25000);
    expect(cell("2026-06-01")).toMatchObject({ amountCents: 340000, units: 272, partial: false });
    expect(cell("2027-01-01").amountCents).toBe(340000);
  });

  it("no ramp means one full-rate phase; flat contracts get one flat phase", () => {
    expect(rampPhases({ steps: [], start: "2026-01-01", align: "calendar", fullUnits: 100, rateCents: 1250 })).toEqual([
      { label: "Full rate", effective_start: "2026-01-01", billable_units: 100, rate_per_unit_cents: 1250, flat_amount_cents: null },
    ]);
    expect(flatPhase("2026-06-01", 210000)[0]).toMatchObject({ flat_amount_cents: 210000, billable_units: null });
  });

  it("works out the last day of the term", () => {
    expect(termEnd("2025-06-01", 6)).toBe("2031-05-31");
    expect(termEnd("2025-07-20", 1)).toBe("2026-07-19");
    expect(termEnd("2024-02-29", 1)).toBe("2025-02-27");
  });
});
