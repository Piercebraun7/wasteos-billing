import { addDays } from "./dates";
import { divideRoundHalfUp } from "./invoice-math";

export type FeeTerms = { percent_bps: number; flat_amount_cents: number; grace_days: number; frequency: string; recurrence_interval_days: number | null; compounding: boolean };

/** The dates on which a late fee falls due for an invoice, up to today: the day after the grace period, then every interval. */
export function feeDates(dueDate: string, terms: FeeTerms, today: string): string[] {
  const first = addDays(dueDate, terms.grace_days + 1);
  if (first > today) return [];
  if (terms.frequency !== "recurring" || !terms.recurrence_interval_days) return [first];
  const dates: string[] = [];
  for (let d = first; d <= today && dates.length < 120; d = addDays(d, terms.recurrence_interval_days)) dates.push(d);
  return dates;
}

/**
 * The late fees that should exist for one invoice and do not yet.
 *   openCents:        what is still unpaid on the invoice itself
 *   alreadyCharged:   how many fee periods have been charged already, here or
 *                     in QuickBooks before the invoice was brought in
 *   unpaidFeesCents:  earlier fees for this invoice that are still unpaid
 * With compounding, a fee is worked out on the invoice plus its unpaid fees.
 */
export function feesToDraft(input: { dueDate: string; openCents: number; alreadyCharged: number; unpaidFeesCents: number }, terms: FeeTerms, today: string): { period: number; feeDate: string; baseCents: number; amountCents: number }[] {
  if (input.openCents <= 0) return [];
  const out: { period: number; feeDate: string; baseCents: number; amountCents: number }[] = [];
  let unpaidFees = input.unpaidFeesCents;
  feeDates(input.dueDate, terms, today).forEach((feeDate, i) => {
    const period = i + 1;
    if (period <= input.alreadyCharged) return;
    const baseCents = input.openCents + (terms.compounding ? unpaidFees : 0);
    const amountCents = divideRoundHalfUp(baseCents * terms.percent_bps, 10000) + terms.flat_amount_cents;
    if (amountCents <= 0) return;
    out.push({ period, feeDate, baseCents, amountCents });
    unpaidFees += amountCents;
  });
  return out;
}
