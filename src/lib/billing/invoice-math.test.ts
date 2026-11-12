import { describe, expect, it } from "vitest";
import { addDays, daysInMonth, firstWeekdayOfMonth, monthEnd, todayInPhoenix } from "./dates";
import { applyTax, eventLines, invoiceDates, mayInvoice, prorate, recurringLines, type DraftLine, type Phase } from "./invoice-math";

const valet = (id: string, start: string, units: number, rate: number, label = "Full rate"): Phase => ({
  id, label, effective_start: start, billable_units: units, rate_per_unit_cents: rate, flat_amount_cents: null,
});
const flat = (id: string, start: string, amount: number, label = "Full rate"): Phase => ({
  id, label, effective_start: start, billable_units: null, rate_per_unit_cents: null, flat_amount_cents: amount,
});
const sum = (lines: DraftLine[]) => lines.reduce((s, l) => s + l.amount_cents, 0);
const FULL = 240 * 1250; // $3,000.00

describe("dates", () => {
  it("knows month lengths, including leap years", () => {
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2100, 2)).toBe(28);
    expect(daysInMonth(2026, 11)).toBe(30);
    expect(daysInMonth(2026, 12)).toBe(31);
    expect(monthEnd("2028-02-10")).toBe("2028-02-29");
  });
  it("adds days across month and year ends", () => {
    expect(addDays("2026-11-30", 30)).toBe("2026-12-30");
    expect(addDays("2026-12-31", 30)).toBe("2027-01-30");
    expect(addDays("2027-03-01", -1)).toBe("2027-02-28");
  });
  it("finds the first Monday of a month", () => {
    expect(firstWeekdayOfMonth("2026-11-01", 1)).toBe("2026-11-02");
    expect(firstWeekdayOfMonth("2026-12-01", 1)).toBe("2026-12-07");
    expect(firstWeekdayOfMonth("2027-02-01", 1)).toBe("2027-02-01");
    expect(firstWeekdayOfMonth("2026-12-01", 2)).toBe("2026-12-01");
  });
  it("uses Phoenix time (UTC minus 7, no daylight saving)", () => {
    expect(todayInPhoenix(new Date("2026-12-01T06:59:00Z"))).toBe("2026-11-30");
    expect(todayInPhoenix(new Date("2026-12-01T07:00:00Z"))).toBe("2026-12-01");
    expect(todayInPhoenix(new Date("2026-07-01T06:59:00Z"))).toBe("2026-06-30");
  });
});

describe("prorate: monthly amount x days in service / days in month, half up", () => {
  it.each([
    // [monthly, days, days in month, expected]
    [300000, 14, 28, 150000],
    [300000, 1, 28, 10714], // 10714.29
    [300000, 1, 29, 10345], // 10344.83 rounds up
    [300000, 1, 30, 10000],
    [300000, 1, 31, 9677], // 9677.42
    [300000, 15, 31, 145161], // 145161.29
    [300000, 16, 31, 154839], // 154838.71 rounds up
    [100, 1, 8, 13], // 12.5 rounds half up
    [100, 3, 8, 38], // 37.5 rounds half up
    [186250, 20, 28, 133036], // 133035.71
    [0, 10, 30, 0],
  ])("%i cents, %i of %i days -> %i", (monthly, days, dim, expected) => {
    expect(prorate(monthly, days, dim)).toBe(expected);
  });
  it("a full month is never rounded", () => {
    for (const dim of [28, 29, 30, 31]) expect(prorate(186251, dim, dim)).toBe(186251);
  });
});

describe("recurring lines", () => {
  it.each([
    ["2027-02-01", 28], ["2028-02-01", 29], ["2026-11-01", 30], ["2026-12-01", 31],
  ])("full month of %s (%i days) bills the full amount on one line", (month) => {
    const lines = recurringLines({ model: "per_unit_valet", phases: [valet("p", "2026-01-01", 240, 1250)], serviceMonth: month });
    expect(lines).toHaveLength(1);
    expect(lines[0].amount_cents).toBe(FULL);
    expect(lines[0].description).toBe("Valet service, 240 units at $12.50");
    expect(lines[0].quantity).toBe(240);
  });

  it("starts on the first day: full month", () => {
    const lines = recurringLines({ model: "per_unit_valet", phases: [valet("p", "2026-11-01", 240, 1250)], serviceMonth: "2026-11-01", contractStart: "2026-11-01" });
    expect(sum(lines)).toBe(FULL);
  });

  it.each([
    ["2027-02-28", 28, 10714], ["2028-02-29", 29, 10345], ["2026-11-30", 30, 10000], ["2026-12-31", 31, 9677],
  ])("starts on the last day %s: one day of %i", (start, dim, expected) => {
    const lines = recurringLines({ model: "per_unit_valet", phases: [valet("p", start, 240, 1250)], serviceMonth: start });
    expect(lines).toHaveLength(1);
    expect(lines[0].amount_cents).toBe(expected);
    expect(lines[0].description).toContain(`(1 of ${dim} days)`);
  });

  it.each([
    ["2027-02-15", 14, 28, 150000], ["2028-02-15", 15, 29, 155172], ["2026-11-16", 15, 30, 150000], ["2026-12-17", 15, 31, 145161],
  ])("starts mid-month %s: %i of %i days", (start, days, dim, expected) => {
    const lines = recurringLines({ model: "per_unit_valet", phases: [valet("p", start, 240, 1250)], serviceMonth: start });
    expect(lines[0].amount_cents).toBe(expected);
    expect(lines[0].period_start).toBe(start);
    expect(lines[0].description).toContain(`(${days} of ${dim} days)`);
  });

  it("bills nothing before the first phase starts or after the contract ends", () => {
    const phases = [valet("p", "2026-12-01", 240, 1250)];
    expect(recurringLines({ model: "per_unit_valet", phases, serviceMonth: "2026-11-01" })).toEqual([]);
    expect(recurringLines({ model: "per_unit_valet", phases, serviceMonth: "2027-03-01", contractEnd: "2027-02-28" })).toEqual([]);
    const ending = recurringLines({ model: "per_unit_valet", phases, serviceMonth: "2027-01-01", contractEnd: "2027-01-10" });
    expect(ending[0].amount_cents).toBe(prorate(FULL, 10, 31));
    expect(ending[0].period_end).toBe("2027-01-10");
  });

  it("one phase change mid-month gives two prorated lines with date ranges", () => {
    const lines = recurringLines({
      model: "per_unit_valet",
      phases: [valet("a", "2026-01-01", 100, 1250, "Phase 1"), valet("b", "2026-11-16", 240, 1250, "Full rate")],
      serviceMonth: "2026-11-01",
    });
    expect(lines.map((l) => [l.contract_phase_id, l.period_start, l.period_end, l.amount_cents])).toEqual([
      ["a", "2026-11-01", "2026-11-15", 62500],
      ["b", "2026-11-16", "2026-11-30", 150000],
    ]);
    expect(lines[0].description).toBe("Valet service, 100 units at $12.50, Nov 1 to Nov 15 (15 of 30 days)");
  });

  it("two phase changes in one month give three lines covering every day once", () => {
    const lines = recurringLines({
      model: "per_unit_valet",
      phases: [valet("a", "2026-01-01", 10, 1250), valet("b", "2026-12-11", 20, 1250), valet("c", "2026-12-21", 30, 1250)],
      serviceMonth: "2026-12-01",
    });
    expect(lines.map((l) => [l.period_start, l.period_end])).toEqual([
      ["2026-12-01", "2026-12-10"], ["2026-12-11", "2026-12-20"], ["2026-12-21", "2026-12-31"],
    ]);
    expect(lines.map((l) => l.amount_cents)).toEqual([prorate(12500, 10, 31), prorate(25000, 10, 31), prorate(37500, 11, 31)]);
    expect(lines.map((l) => l.amount_cents)).toEqual([4032, 8065, 13306]);
  });

  it("a free month shows as a $0.00 line", () => {
    const lines = recurringLines({
      model: "per_unit_valet",
      phases: [valet("free", "2026-11-01", 240, 0, "Free month"), valet("paid", "2026-12-16", 240, 1250)],
      serviceMonth: "2026-11-01",
    });
    expect(lines).toHaveLength(1);
    expect(lines[0].amount_cents).toBe(0);
    expect(lines[0].description).toBe("Valet service, Free month");
  });

  it("a free month followed by a partial paid month", () => {
    const lines = recurringLines({
      model: "per_unit_valet",
      phases: [valet("free", "2026-11-01", 240, 0, "Free month"), valet("paid", "2026-12-16", 240, 1250)],
      serviceMonth: "2026-12-01",
    });
    expect(lines.map((l) => l.amount_cents)).toEqual([0, prorate(FULL, 16, 31)]);
    expect(lines[0].description).toBe("Valet service, Free month, Dec 1 to Dec 15 (15 of 31 days)");
    expect(lines[1].amount_cents).toBe(154839);
  });

  it("flat monthly and trash room contracts bill the flat amount", () => {
    const f = recurringLines({ model: "flat_monthly", phases: [flat("p", "2026-01-01", 150000)], serviceMonth: "2026-11-01" });
    expect(f[0]).toMatchObject({ line_type: "flat", amount_cents: 150000, description: "Monthly service, $1,500.00 per month" });
    const t = recurringLines({ model: "trash_room", phases: [flat("p", "2026-11-11", 180000)], serviceMonth: "2026-11-01" });
    expect(t[0].amount_cents).toBe(120000);
    expect(t[0].description).toBe("Trash room management, $1,800.00 per month, Nov 11 to Nov 30 (20 of 30 days)");
  });

  it("ignores superseded phases, and event-only contracts have no recurring lines", () => {
    const phases = [{ ...valet("old", "2026-01-01", 240, 1000), superseded_at: "2026-06-01T00:00:00Z" }, valet("new", "2026-01-01", 240, 1250)];
    const lines = recurringLines({ model: "per_unit_valet", phases, serviceMonth: "2026-11-01" });
    expect(lines.map((l) => l.contract_phase_id)).toEqual(["new"]);
    expect(recurringLines({ model: "per_event", phases: [], serviceMonth: "2026-11-01" })).toEqual([]);
    expect(recurringLines({ model: "as_needed", phases: [], serviceMonth: "2026-11-01" })).toEqual([]);
  });
});

describe("per-event lines", () => {
  const ev = (id: string, date: string, type: string, quantity = 1, time_window: string | null = null) => ({
    id, event_date: date, event_type: type, time_window, quantity, description: null,
  });
  const rates = [
    { event_type: "bulk_pickup", time_window: null, rate_cents: 35000 },
    { event_type: "trash_room_visit", time_window: "Morning", rate_cents: 7500 },
    { event_type: "trash_room_visit", time_window: "Evening", rate_cents: 9000 },
  ];

  it("bills events dated inside the service month at the contract rate", () => {
    const { lines, held } = eventLines({
      events: [ev("1", "2026-11-14", "bulk_pickup"), ev("2", "2026-11-01", "bulk_pickup"), ev("3", "2026-10-31", "bulk_pickup"), ev("4", "2026-12-01", "bulk_pickup")],
      rates, serviceMonth: "2026-11-01",
    });
    expect(held).toEqual([]);
    expect(lines.map((l) => [l.billable_event_id, l.amount_cents])).toEqual([["2", 35000], ["1", 35000]]);
    expect(lines[0].description).toBe("Bulk pickup, Nov 1");
  });

  it("uses the rate for the matching visit window", () => {
    const { lines } = eventLines({
      events: [ev("1", "2026-11-03", "trash_room_visit", 1, "Morning"), ev("2", "2026-11-03", "trash_room_visit", 2, "Evening")],
      rates, serviceMonth: "2026-11-01",
    });
    expect(lines.map((l) => l.amount_cents)).toEqual([7500, 18000]);
  });

  it("holds an event with no rate instead of guessing", () => {
    const { lines, held } = eventLines({
      events: [ev("1", "2026-11-03", "dumpster_move"), ev("2", "2026-11-04", "trash_room_visit", 1, "Midnight")],
      rates, serviceMonth: "2026-11-01",
    });
    expect(lines).toEqual([]);
    expect(held.map((e) => e.id)).toEqual(["1", "2"]);
  });

  it("uses a job's own price when it has one, even with no contract rate", () => {
    const { lines, held } = eventLines({
      events: [{ ...ev("1", "2026-11-02", "bulk_pickup", 1.5), rate_cents: 40000 }, { ...ev("2", "2026-11-03", "dumpster_move"), rate_cents: 12500 }],
      rates, serviceMonth: "2026-11-01",
    });
    expect(held).toEqual([]);
    expect(lines.map((l) => [l.unit_price_cents, l.amount_cents])).toEqual([[40000, 60000], [12500, 12500]]);
  });

  it("a resident refund is a negative line that names the unit", () => {
    const { lines } = eventLines({
      events: [{ ...ev("1", "2026-11-06", "resident_refund"), rate_cents: -2500, description: "Unit 1006" }],
      rates, serviceMonth: "2026-11-01",
    });
    expect(lines[0]).toMatchObject({ line_type: "adjustment", amount_cents: -2500, description: "Resident refund, Nov 6: Unit 1006" });
  });

  it("an unbilled refund from an earlier month carries forward; other work does not", () => {
    const events = [
      { ...ev("r", "2026-10-28", "resident_refund"), rate_cents: -2500, description: "Unit 1006" },
      ev("old", "2026-10-28", "bulk_pickup"),
    ];
    const { lines } = eventLines({ events, rates, serviceMonth: "2026-11-01", carryForward: ["resident_refund"] });
    expect(lines.map((l) => [l.billable_event_id, l.amount_cents])).toEqual([["r", -2500]]);
    expect(eventLines({ events, rates, serviceMonth: "2026-11-01" }).lines).toEqual([]);
  });

  it("handles fractional quantities without floating point drift", () => {
    const { lines } = eventLines({ events: [ev("1", "2026-11-03", "bulk_pickup", 1.5)], rates, serviceMonth: "2026-11-01" });
    expect(lines[0].amount_cents).toBe(52500);
  });
});

describe("tax", () => {
  const charge = (amount: number): DraftLine => ({
    line_type: "valet", description: "x", quantity: 1, unit_price_cents: amount, amount_cents: amount,
    contract_phase_id: null, billable_event_id: null, period_start: null, period_end: null,
  });

  it("tax off: both bases bill exactly the quoted figure", () => {
    for (const basis of ["pre_tax", "tax_inclusive", null] as const) {
      const t = applyTax([charge(186250)], { enabled: false, rateBps: 860, basis });
      expect(t).toMatchObject({ subtotal_cents: 186250, tax_cents: 0, total_cents: 186250 });
      expect(t.lines).toHaveLength(1);
    }
  });

  it("tax on, pre-tax basis: tax is added on top", () => {
    // The Liberty Farms contract figures: $1,862.50 at 8.6% is $2,022.68 (tax $160.175 rounds half up).
    const t = applyTax([charge(186250)], { enabled: true, rateBps: 860, basis: "pre_tax" });
    expect(t).toMatchObject({ subtotal_cents: 186250, tax_cents: 16018, total_cents: 202268 });
    expect(t.lines.at(-1)).toMatchObject({ line_type: "tax", amount_cents: 16018, description: "Sales tax, 8.6%" });
  });

  it("tax on, tax-inclusive basis: net and tax sum exactly to the quoted amount", () => {
    for (const quoted of [202268, 186250, 300000, 1, 99, 100, 333333, 12345]) {
      for (const rateBps of [860, 825, 1000, 1]) {
        const t = applyTax([charge(quoted)], { enabled: true, rateBps, basis: "tax_inclusive" });
        expect(t.total_cents).toBe(quoted);
        expect(t.subtotal_cents + t.tax_cents).toBe(quoted);
        expect(t.lines.reduce((s, l) => s + l.amount_cents, 0)).toBe(quoted);
      }
    }
    const t = applyTax([charge(202268)], { enabled: true, rateBps: 860, basis: "tax_inclusive" });
    expect(t).toMatchObject({ subtotal_cents: 186250, tax_cents: 16018 });
  });

  it("tax-inclusive with several lines still sums exactly", () => {
    const t = applyTax([charge(62500), charge(150000), charge(35000)], { enabled: true, rateBps: 860, basis: "tax_inclusive" });
    expect(t.total_cents).toBe(247500);
    expect(t.lines.reduce((s, l) => s + l.amount_cents, 0)).toBe(247500);
  });
});

describe("invoice dates and cutover", () => {
  it("invoice date is the last day of the service month; due date adds net days", () => {
    expect(invoiceDates("2026-11-01", 30)).toEqual({ invoice_date: "2026-11-30", due_date: "2026-12-30" });
    expect(invoiceDates("2026-12-01", 15)).toEqual({ invoice_date: "2026-12-31", due_date: "2027-01-15" });
    expect(invoiceDates("2028-02-01", 30)).toEqual({ invoice_date: "2028-02-29", due_date: "2028-03-30" });
  });
  it("refuses any month before the account's go-live service month", () => {
    expect(mayInvoice("2026-10-01", "2026-11-01")).toBe(false);
    expect(mayInvoice("2026-11-01", "2026-11-01")).toBe(true);
    expect(mayInvoice("2026-12-01", "2026-11-01")).toBe(true);
    expect(mayInvoice("2026-11-01", null)).toBe(false);
  });
});
