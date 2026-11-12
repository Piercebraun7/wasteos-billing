// Invoice calculation. Pure functions, integer cents only, no floating point.

import { formatCents } from "../money";
import { addDays, daysInMonth, iso, monthEnd, monthStart, parts, shortDay, type ISODate } from "./dates";

export type BillingModel = "per_unit_valet" | "flat_monthly" | "per_event" | "as_needed" | "trash_room";

export type Phase = {
  id: string;
  label: string;
  effective_start: ISODate;
  billable_units: number | null;
  rate_per_unit_cents: number | null;
  flat_amount_cents: number | null;
  superseded_at?: string | null;
};

export type DraftLine = {
  line_type: "valet" | "flat" | "per_event" | "tax" | "adjustment";
  description: string;
  quantity: number;
  unit_price_cents: number;
  amount_cents: number;
  contract_phase_id: string | null;
  billable_event_id: string | null;
  period_start: ISODate | null;
  period_end: ISODate | null;
};

/** Divides two non-negative whole numbers, rounding half up. */
export function divideRoundHalfUp(numerator: number, denominator: number): number {
  return Math.floor((2 * numerator + denominator) / (2 * denominator));
}

/** monthly amount x days in service / actual days in that month, rounded half up to the cent. */
export function prorate(monthlyCents: number, daysInService: number, daysInTheMonth: number): number {
  if (daysInService >= daysInTheMonth) return monthlyCents;
  if (daysInService <= 0) return 0;
  return divideRoundHalfUp(monthlyCents * daysInService, daysInTheMonth);
}

export function phaseMonthlyCents(phase: Phase): number {
  if (phase.flat_amount_cents !== null) return phase.flat_amount_cents;
  return (phase.billable_units ?? 0) * (phase.rate_per_unit_cents ?? 0);
}

const SERVICE_NAME: Record<BillingModel, string> = {
  per_unit_valet: "Valet service",
  flat_monthly: "Monthly service",
  trash_room: "Trash room management",
  per_event: "Service",
  as_needed: "Service",
};

/**
 * Recurring charges for one service month. Each day is billed at the phase in
 * effect that day, so a phase change mid-month yields one prorated line per phase.
 */
export function recurringLines(input: {
  model: BillingModel;
  phases: Phase[];
  serviceMonth: ISODate;
  contractStart?: ISODate | null;
  contractEnd?: ISODate | null;
}): DraftLine[] {
  const { model } = input;
  if (model === "per_event" || model === "as_needed") return [];

  const first = monthStart(input.serviceMonth);
  const last = monthEnd(input.serviceMonth);
  const { y, m } = parts(first);
  const dim = daysInMonth(y, m);
  const phases = input.phases
    .filter((p) => !p.superseded_at)
    .sort((a, b) => a.effective_start.localeCompare(b.effective_start));

  // Billable window inside the month.
  let from = first;
  let to = last;
  if (input.contractStart && input.contractStart > from) from = input.contractStart;
  if (input.contractEnd && input.contractEnd < to) to = input.contractEnd;
  if (from > to) return [];

  const lines: DraftLine[] = [];
  for (let i = 0; i < phases.length; i++) {
    const phase = phases[i];
    const next = phases[i + 1];
    const segStart = phase.effective_start > from ? phase.effective_start : from;
    const phaseLast = next ? addDays(next.effective_start, -1) : to;
    const segEnd = phaseLast < to ? phaseLast : to;
    if (segStart > segEnd) continue;

    const days = parts(segEnd).d - parts(segStart).d + 1;
    const monthly = phaseMonthlyCents(phase);
    // A valet contract can still carry a flat-fee phase (for example $800.00 for 36 units).
    const perUnit = model === "per_unit_valet" && phase.flat_amount_cents === null;
    const amount = prorate(monthly, days, dim);
    const partial = days < dim;

    let basis: string;
    if (monthly === 0) {
      basis = phase.label;
    } else if (perUnit) {
      basis = `${phase.billable_units} units at ${formatCents(phase.rate_per_unit_cents ?? 0)}`;
    } else {
      basis = `${formatCents(monthly)} per month`;
    }
    const range = partial ? `, ${shortDay(segStart)} to ${shortDay(segEnd)} (${days} of ${dim} days)` : "";

    lines.push({
      line_type: model === "per_unit_valet" ? "valet" : "flat",
      description: `${SERVICE_NAME[model]}, ${basis}${range}`,
      quantity: perUnit ? (phase.billable_units ?? 0) : 1,
      unit_price_cents: perUnit ? (phase.rate_per_unit_cents ?? 0) : monthly,
      amount_cents: amount,
      contract_phase_id: phase.id,
      billable_event_id: null,
      period_start: segStart,
      period_end: segEnd,
    });
  }
  return lines;
}

export type BillableEvent = {
  id: string;
  event_date: ISODate;
  event_type: string;
  time_window: string | null;
  quantity: number;
  description: string | null;
  /** A price for this job alone. When set, it is used instead of the contract's rate. */
  rate_cents?: number | null;
};
export type EventRate = { event_type: string; time_window: string | null; rate_cents: number };

const EVENT_NAME: Record<string, string> = {
  dumpster_move: "Dumpster move",
  bulk_pickup: "Bulk pickup",
  trash_room_visit: "Trash room visit",
  as_needed: "As-needed job",
  other: "Other work",
  resident_refund: "Resident refund",
};

/** The rate for an event: its own price if it has one, then an exact window match on the contract, then the contract rate with no window. */
export function rateFor(event: BillableEvent, rates: EventRate[]): number | null {
  if (event.rate_cents != null) return Number(event.rate_cents);
  const sameType = rates.filter((r) => r.event_type === event.event_type);
  const exact = sameType.find((r) => (r.time_window ?? "") === (event.time_window ?? ""));
  if (exact) return exact.rate_cents;
  const general = sameType.find((r) => !r.time_window);
  return general ? general.rate_cents : null;
}

/**
 * Per-event charges dated within the service month. An event with no rate on
 * the contract is returned as held, never billed at a guessed rate.
 */
export function eventLines(input: {
  events: BillableEvent[];
  rates: EventRate[];
  serviceMonth: ISODate;
  /** Event types that also carry forward from earlier months when they were not yet billed (resident refunds). */
  carryForward?: string[];
}): {
  lines: DraftLine[];
  held: BillableEvent[];
} {
  const first = monthStart(input.serviceMonth);
  const last = monthEnd(input.serviceMonth);
  const lines: DraftLine[] = [];
  const held: BillableEvent[] = [];
  const inMonth = input.events
    .filter((e) => e.event_date <= last && (e.event_date >= first || (input.carryForward ?? []).includes(e.event_type)))
    .sort((a, b) => a.event_date.localeCompare(b.event_date));
  for (const event of inMonth) {
    const rate = rateFor(event, input.rates);
    if (rate === null) {
      held.push(event);
      continue;
    }
    // Quantities may have two decimals (for example 1.5 hours): work in hundredths.
    const hundredths = Math.round(event.quantity * 100);
    const name = EVENT_NAME[event.event_type] ?? event.event_type;
    const window = event.time_window ? ` (${event.time_window})` : "";
    const qty = event.quantity === 1 ? "" : `, ${event.quantity} at ${formatCents(rate)}`;
    // A refund carries a negative price: round the size, then put the sign back.
    const size = divideRoundHalfUp(Math.abs(rate) * hundredths, 100);
    lines.push({
      line_type: rate < 0 ? "adjustment" : "per_event",
      description: `${name}${window}, ${shortDay(event.event_date)}${qty}${event.description ? `: ${event.description}` : ""}`,
      quantity: event.quantity,
      unit_price_cents: rate,
      amount_cents: rate < 0 ? -size : size,
      contract_phase_id: null,
      billable_event_id: event.id,
      period_start: event.event_date,
      period_end: event.event_date,
    });
  }
  return { lines, held };
}

export type Totals = { lines: DraftLine[]; subtotal_cents: number; tax_cents: number; total_cents: number };

/**
 * Tax off: bill exactly the quoted figures. Tax on, pre-tax basis: tax is added
 * on top. Tax on, tax-inclusive basis: each quoted figure is split into net and
 * tax so the invoice total equals the quoted total exactly.
 */
export function applyTax(
  charges: DraftLine[],
  tax: { enabled: boolean; rateBps: number; basis: "pre_tax" | "tax_inclusive" | null },
): Totals {
  const quoted = charges.reduce((sum, l) => sum + l.amount_cents, 0);
  if (!tax.enabled || tax.rateBps === 0) {
    return { lines: charges, subtotal_cents: quoted, tax_cents: 0, total_cents: quoted };
  }
  const percent = `${Math.floor(tax.rateBps / 100)}.${String(tax.rateBps % 100).padStart(2, "0")}`.replace(/\.?0+$/, "");
  const taxLine = (amount: number): DraftLine => ({
    line_type: "tax",
    description: `Sales tax, ${percent}%`,
    quantity: 1,
    unit_price_cents: amount,
    amount_cents: amount,
    contract_phase_id: null,
    billable_event_id: null,
    period_start: null,
    period_end: null,
  });

  if (tax.basis === "tax_inclusive") {
    const net = charges.map((l) => ({
      ...l,
      amount_cents: divideRoundHalfUp(l.amount_cents * 10000, 10000 + tax.rateBps),
    }));
    const subtotal = net.reduce((sum, l) => sum + l.amount_cents, 0);
    const taxCents = quoted - subtotal;
    return { lines: [...net, taxLine(taxCents)], subtotal_cents: subtotal, tax_cents: taxCents, total_cents: quoted };
  }

  const taxCents = divideRoundHalfUp(quoted * tax.rateBps, 10000);
  return { lines: [...charges, taxLine(taxCents)], subtotal_cents: quoted, tax_cents: taxCents, total_cents: quoted + taxCents };
}

/** Invoice date is the last day of the service month; due date is that plus the contract's net days. */
export function invoiceDates(serviceMonth: ISODate, netDays: number): { invoice_date: ISODate; due_date: ISODate } {
  const invoice_date = monthEnd(serviceMonth);
  return { invoice_date, due_date: addDays(invoice_date, netDays) };
}

/** True when the app may invoice this month for the account (prevents double billing at cutover). */
export function mayInvoice(serviceMonth: ISODate, goLiveServiceMonth: ISODate | null): boolean {
  return goLiveServiceMonth !== null && monthStart(serviceMonth) >= monthStart(goLiveServiceMonth);
}

export { iso };
