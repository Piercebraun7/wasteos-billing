// The schedule of billing: what each property is due to be billed each month,
// worked out from its contract phases by the same engine that drafts invoices.

import { daysInMonth, iso, parts, type ISODate } from "./dates";
import { recurringLines, type BillingModel, type Phase } from "./invoice-math";

export type ScheduleCell = {
  month: ISODate; // first day of the month
  amountCents: number | null; // null: nothing scheduled (before start, after end, or event-only)
  units: number | null;
  free: boolean;
  partial: boolean; // a prorated month or a mid-month phase change
  phaseStarts: boolean; // a new phase takes effect during this month
};

export function scheduleCell(input: {
  model: BillingModel;
  phases: Phase[];
  month: ISODate;
  contractStart?: ISODate | null;
  contractEnd?: ISODate | null;
}): ScheduleCell {
  const { y, m } = parts(input.month);
  const first = iso(y, m, 1);
  const last = iso(y, m, daysInMonth(y, m));
  const lines = recurringLines({ model: input.model, phases: input.phases, serviceMonth: first, contractStart: input.contractStart, contractEnd: input.contractEnd });
  if (lines.length === 0) return { month: first, amountCents: null, units: null, free: false, partial: false, phaseStarts: false };
  const amount = lines.reduce((sum, l) => sum + l.amount_cents, 0);
  const lastLine = lines[lines.length - 1];
  const covered = lines[0].period_start === first && lastLine.period_end === last;
  return {
    month: first,
    amountCents: amount,
    units: input.model === "per_unit_valet" ? lastLine.quantity : null,
    free: amount === 0,
    partial: lines.length > 1 || !covered,
    phaseStarts: input.phases.some((p) => !p.superseded_at && p.effective_start >= first && p.effective_start <= last),
  };
}

export function monthsOfYear(year: number): ISODate[] {
  return Array.from({ length: 12 }, (_, i) => iso(year, i + 1, 1));
}

/** The first day of the month after the given one. */
export function nextMonth(month: ISODate): ISODate {
  const { y, m } = parts(month);
  return m === 12 ? iso(y + 1, 1, 1) : iso(y, m + 1, 1);
}
