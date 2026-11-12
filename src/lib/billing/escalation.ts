// Annual rate increases. The first takes effect at the start of month 13
// (month 1 is the month service started), then every 12 months after.

import { divideRoundHalfUp, type Phase } from "./invoice-math";
import { iso, parts, type ISODate } from "./dates";

export type Decision = { effective_month: ISODate; percent_bps: number; status: "confirmed" | "skipped"; notice_sent_at?: string | null };
export type Increase = { effective: ISODate; bps: number; confirmed: boolean; noticeSentAt: string | null };

/** The first day of the month an increase takes effect: n years after the month service started. */
export function increaseDate(start: ISODate, n: number): ISODate {
  const { y, m } = parts(start);
  return iso(y + n, m, 1);
}

/**
 * Every increase from the start of service through a date. A year with no
 * decision is planned at the contract's standard percent. A skipped year is left out.
 */
export function increasesThrough(input: { start: ISODate | null; standardBps: number; decisions: Decision[]; through: ISODate }): Increase[] {
  if (!input.start) return [];
  const out: Increase[] = [];
  for (let n = 1; n < 60; n++) {
    const effective = increaseDate(input.start, n);
    if (effective > input.through) break;
    const decision = input.decisions.find((d) => d.effective_month === effective);
    if (decision?.status === "skipped") continue;
    const bps = decision ? decision.percent_bps : input.standardBps;
    if (bps <= 0) continue;
    out.push({ effective, bps, confirmed: decision?.status === "confirmed", noticeSentAt: decision?.notice_sent_at ?? null });
  }
  return out;
}

/** One increase applied to an amount in cents, rounded half up to the cent. */
export function raise(cents: number, bps: number): number {
  return divideRoundHalfUp(cents * (10000 + bps), 10000);
}

/**
 * The phases with increases applied: each phase is split at every increase
 * date that falls inside it, and its rate is raised step by step. An increase
 * applies to lease-up rates as well as the full rate. A free phase stays free.
 */
export function escalatePhases(phases: Phase[], increases: { effective: ISODate; bps: number }[]): Phase[] {
  const sorted = phases.filter((p) => !p.superseded_at).sort((a, b) => a.effective_start.localeCompare(b.effective_start));
  const steps = [...increases].sort((a, b) => a.effective.localeCompare(b.effective));
  if (steps.length === 0) return sorted;
  const out: Phase[] = [];
  sorted.forEach((phase, i) => {
    const end = sorted[i + 1]?.effective_start ?? "9999-12-31";
    let rate = phase.rate_per_unit_cents;
    let flat = phase.flat_amount_cents;
    let applied = 0;
    const push = (start: ISODate) =>
      out.push({
        ...phase,
        effective_start: start,
        rate_per_unit_cents: rate,
        flat_amount_cents: flat,
        label: applied ? `${phase.label}, after ${applied} annual increase${applied === 1 ? "" : "s"}` : phase.label,
      });
    // Increases already in effect when this phase starts.
    for (const s of steps) {
      if (s.effective > phase.effective_start) break;
      if (rate !== null) rate = raise(rate, s.bps);
      if (flat !== null) flat = raise(flat, s.bps);
      applied++;
    }
    push(phase.effective_start);
    // Increases that land while this phase is in effect.
    for (const s of steps) {
      if (s.effective <= phase.effective_start || s.effective >= end) continue;
      if (rate !== null) rate = raise(rate, s.bps);
      if (flat !== null) flat = raise(flat, s.bps);
      applied++;
      push(s.effective);
    }
  });
  return out;
}

/** The phases to bill from: confirmed increases only. Nothing goes up until it is confirmed. */
export function billingPhases(contract: { start_date: ISODate | null; escalation_bps?: number | null; phases: Phase[]; increases?: Decision[] | null }, through: ISODate): Phase[] {
  const all = increasesThrough({ start: contract.start_date, standardBps: contract.escalation_bps ?? 0, decisions: contract.increases ?? [], through });
  return escalatePhases(contract.phases, all.filter((i) => i.confirmed));
}

/**
 * The phases to show on the schedule: confirmed increases, plus planned ones
 * that are still ahead. A planned increase whose date passed without being
 * confirmed never took effect, so it is not shown as if it had.
 */
export function plannedPhases(
  contract: { start_date: ISODate | null; escalation_bps?: number | null; phases: Phase[]; increases?: Decision[] | null },
  through: ISODate,
  today: ISODate,
): Phase[] {
  const all = increasesThrough({ start: contract.start_date, standardBps: contract.escalation_bps ?? 0, decisions: contract.increases ?? [], through });
  return escalatePhases(contract.phases, all.filter((i) => i.confirmed || i.effective > today));
}
