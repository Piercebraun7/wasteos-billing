// Turns a contract's lease-up schedule into dated billing phases.

import { daysInMonth, iso, parts, type ISODate } from "../billing/dates";
import type { RampStep } from "./parse";

export type NewPhase = {
  label: string;
  effective_start: ISODate;
  billable_units: number | null;
  rate_per_unit_cents: number | null;
  flat_amount_cents: number | null;
};

export type Alignment = "calendar" | "anniversary";

/** The date a schedule month begins. Month 1 always begins on the service start date. */
export function rampMonthStart(start: ISODate, month: number, align: Alignment): ISODate {
  if (month <= 1) return start;
  const { y, m, d } = parts(start);
  const index = m - 1 + (month - 1);
  const year = y + Math.floor(index / 12);
  const mon = (index % 12) + 1;
  if (align === "calendar") return iso(year, mon, 1);
  return iso(year, mon, Math.min(d, daysInMonth(year, mon)));
}

/** Adds whole years, landing on the day before the anniversary: a 6 year term from Jun 1, 2025 ends May 31, 2031. */
export function termEnd(start: ISODate, years: number): ISODate {
  const { y, m, d } = parts(start);
  const t = new Date(Date.UTC(y + years, m - 1, Math.min(d, daysInMonth(y + years, m)) - 1));
  return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/**
 * Per-unit contract: one phase per step of the ramp. Neighbouring steps that
 * bill the same are merged (three free months become one phase).
 */
export function rampPhases(input: {
  steps: RampStep[];
  start: ISODate;
  align: Alignment;
  fullUnits: number;
  rateCents: number;
}): NewPhase[] {
  const { start, align, fullUnits, rateCents } = input;
  const steps = [...input.steps].sort((a, b) => a.month - b.month);
  if (steps.length === 0) {
    return [{ label: "Full rate", effective_start: start, billable_units: fullUnits, rate_per_unit_cents: rateCents, flat_amount_cents: null }];
  }
  const phases: NewPhase[] = [];
  for (const step of steps) {
    const units = step.free ? fullUnits : (step.units ?? fullUnits);
    const rate = step.free ? 0 : rateCents;
    const last = phases.at(-1);
    if (last && last.billable_units === units && last.rate_per_unit_cents === rate) {
      if (step.free) last.label = "Free months";
      continue;
    }
    const full = !step.free && step.units === null;
    phases.push({
      label: step.free ? "Free month" : full ? "Full rate" : `Lease-up month ${step.month}`,
      effective_start: rampMonthStart(start, step.month, align),
      billable_units: units,
      rate_per_unit_cents: rate,
      flat_amount_cents: null,
    });
  }
  return phases;
}

export function flatPhase(start: ISODate, monthlyCents: number): NewPhase[] {
  return [{ label: "Monthly fee", effective_start: start, billable_units: null, rate_per_unit_cents: null, flat_amount_cents: monthlyCents }];
}
