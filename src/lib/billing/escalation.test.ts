import { describe, expect, it } from "vitest";
import { billingPhases, escalatePhases, increaseDate, increasesThrough, plannedPhases, raise } from "./escalation";
import { recurringLines, type Phase } from "./invoice-math";

const valet = (id: string, start: string, units: number, rate: number, label = "Full rate"): Phase => ({
  id, label, effective_start: start, billable_units: units, rate_per_unit_cents: rate, flat_amount_cents: null,
});
const amount = (phases: Phase[], month: string, model: "per_unit_valet" | "trash_room" = "per_unit_valet") =>
  recurringLines({ model, phases, serviceMonth: month }).reduce((s, l) => s + l.amount_cents, 0);

describe("when an increase takes effect", () => {
  it("is the start of month 13, counting the start month as month 1", () => {
    expect(increaseDate("2026-01-29", 1)).toBe("2027-01-01"); // a January start: February 2026 is month 2
    expect(increaseDate("2025-02-09", 1)).toBe("2026-02-01");
    expect(increaseDate("2025-11-12", 2)).toBe("2027-11-01");
    expect(increaseDate("2025-12-31", 1)).toBe("2026-12-01");
  });

  it("plans every year at the standard percent, uses a confirmed percent, and leaves out a skipped year", () => {
    const list = increasesThrough({
      start: "2024-03-15", standardBps: 300, through: "2028-01-01",
      decisions: [{ effective_month: "2025-03-01", percent_bps: 250, status: "confirmed", notice_sent_at: "2024-12-01T00:00:00Z" }, { effective_month: "2026-03-01", percent_bps: 300, status: "skipped" }],
    });
    expect(list.map((i) => [i.effective, i.bps, i.confirmed])).toEqual([["2025-03-01", 250, true], ["2027-03-01", 300, false]]);
  });

  it("has none before the first anniversary or with no start date", () => {
    expect(increasesThrough({ start: "2026-01-29", standardBps: 300, decisions: [], through: "2026-12-31" })).toEqual([]);
    expect(increasesThrough({ start: null, standardBps: 300, decisions: [], through: "2030-01-01" })).toEqual([]);
  });
});

describe("the rate after an increase", () => {
  it("rounds half up to the cent", () => {
    expect(raise(1250, 300)).toBe(1288); // 12.875
    expect(raise(1288, 300)).toBe(1327); // 13.2664
    expect(raise(210000, 300)).toBe(216300);
    expect(raise(1000, 300)).toBe(1030);
    expect(raise(0, 300)).toBe(0);
  });

  it("raises the per-unit rate from month 13 and compounds each year", () => {
    const phases = escalatePhases([valet("p", "2025-02-09", 149, 1250)], [{ effective: "2026-02-01", bps: 300 }, { effective: "2027-02-01", bps: 300 }]);
    expect(phases.map((p) => [p.effective_start, p.rate_per_unit_cents])).toEqual([["2025-02-09", 1250], ["2026-02-01", 1288], ["2027-02-01", 1327]]);
    expect(amount(phases, "2026-01-01")).toBe(149 * 1250);
    expect(amount(phases, "2026-02-01")).toBe(149 * 1288);
    expect(amount(phases, "2027-02-01")).toBe(149 * 1327);
    expect(phases.every((p) => p.id === "p")).toBe(true);
  });

  it("raises a flat monthly fee", () => {
    const flat: Phase = { id: "f", label: "Monthly fee", effective_start: "2025-06-01", billable_units: null, rate_per_unit_cents: null, flat_amount_cents: 210000 };
    const phases = escalatePhases([flat], [{ effective: "2026-06-01", bps: 300 }]);
    expect(amount(phases, "2026-05-01", "trash_room")).toBe(210000);
    expect(amount(phases, "2026-06-01", "trash_room")).toBe(216300);
  });

  it("applies to lease-up phases too, and leaves a free phase free", () => {
    const phases = escalatePhases(
      [valet("free", "2026-01-10", 240, 0, "Free months"), valet("a", "2026-04-01", 100, 1250, "Lease-up"), valet("b", "2027-03-01", 240, 1250)],
      [{ effective: "2027-01-01", bps: 300 }],
    );
    expect(phases.map((p) => [p.id, p.effective_start, p.rate_per_unit_cents])).toEqual([
      ["free", "2026-01-10", 0], ["a", "2026-04-01", 1250], ["a", "2027-01-01", 1288], ["b", "2027-03-01", 1288],
    ]);
  });

  it("with no increases, the phases are untouched", () => {
    const base = [valet("p", "2025-02-09", 149, 1250)];
    expect(escalatePhases(base, [])).toEqual(base);
  });
});

describe("billing waits for confirmation", () => {
  const contract = { start_date: "2025-02-09", escalation_bps: 300, phases: [valet("p", "2025-02-09", 149, 1250)] };

  it("a planned increase shows on the schedule but is not billed", () => {
    expect(amount(plannedPhases({ ...contract, increases: [] }, "2026-12-31", "2025-11-12"), "2026-02-01")).toBe(149 * 1288);
    expect(amount(billingPhases({ ...contract, increases: [] }, "2026-12-31"), "2026-02-01")).toBe(149 * 1250);
  });

  it("a confirmed increase is billed, at the confirmed percent", () => {
    const increases = [{ effective_month: "2026-02-01", percent_bps: 200, status: "confirmed" as const }];
    expect(amount(billingPhases({ ...contract, increases }, "2026-12-31"), "2026-02-01")).toBe(149 * 1275);
    expect(amount(billingPhases({ ...contract, increases }, "2026-12-31"), "2026-01-01")).toBe(149 * 1250);
  });

  it("a skipped year changes nothing, on the schedule or the bill", () => {
    const increases = [{ effective_month: "2026-02-01", percent_bps: 300, status: "skipped" as const }];
    expect(amount(plannedPhases({ ...contract, increases }, "2026-12-31", "2025-11-12"), "2026-06-01")).toBe(149 * 1250);
  });

  it("an increase whose date passed without being confirmed never took effect", () => {
    // Today is after February 2026 and nothing was confirmed: the schedule stays at the old rate,
    // while next year's increase is still shown as planned.
    const phases = plannedPhases({ ...contract, increases: [] }, "2027-12-31", "2026-11-12");
    expect(amount(phases, "2026-11-01")).toBe(149 * 1250);
    expect(amount(phases, "2027-02-01")).toBe(149 * 1288);
  });
});
