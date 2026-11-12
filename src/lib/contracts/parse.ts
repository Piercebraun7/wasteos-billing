// Reads the basic terms out of a Kaizen service agreement's text.
// Everything found here is shown to a person for review before it is used.

import { iso, type ISODate } from "../billing/dates";
import { parseDollarsToCents } from "../money";

export type RampStep = {
  month: number; // 1-based month of the lease-up schedule
  label: string; // as written, for example "Free", "10 Units", "Full Service Fee"
  free: boolean;
  units: number | null; // null means the full unit count
  totalCents: number | null;
  /** Set when the month's fee is not a whole number of units at the rate, so it is billed as a flat amount. */
  flatCents?: number | null;
};

export type ScrapedTerms = {
  kind: "per_unit" | "flat" | "unknown";
  termYears: number | null;
  commencement: ISODate | null;
  unitCount: number | null;
  ratePerUnitCents: number | null;
  monthlyFeeCents: number | null; // before tax
  ramp: RampStep[];
  lateFeePercent: string | null;
  paymentDays: number | null;
  taxPercent: string | null;
  propertyAddress: string | null;
  billingAddress: string | null;
  /** Days of notice the contract requires before a rate change (30, or 90 for "3 months"). */
  rateNoticeDays?: number | null;
  /** The most the rate may rise in a year, as a percent, when the contract caps it. */
  rateCapPercent?: string | null;
};

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

function parseLongDate(text: string): ISODate | null {
  const m = /([A-Za-z]+),?\s+(\d{1,2}),?\s+(\d{4})/.exec(text);
  if (!m) return null;
  const month = MONTHS.indexOf(m[1].toLowerCase());
  return month < 0 ? null : iso(Number(m[3]), month + 1, Number(m[2]));
}

const money = (text: string | undefined) => (text ? parseDollarsToCents(text) : null);

export function parseContractText(raw: string): ScrapedTerms {
  // Collapse line breaks and stray zero-width characters so patterns can span lines.
  const text = raw.replace(/[​‌‍﻿]/g, "").replace(/\s+/g, " ");

  // "Term: 6 Years, Commencing June 1, 2025" or "Term: 36 Months, Commencing December 10, 2026".
  const term = /Term:\s*(\d+)\s*(Years?|Months?),?\s*Commencing\s+([A-Za-z]+,?\s+\d{1,2},?(?:\s+\d{4})?)/i.exec(text);
  const termCount = term ? Number(term[1]) : null;
  const termYears = termCount === null ? null : /month/i.test(term![2]) ? (termCount % 12 === 0 ? termCount / 12 : null) : termCount;
  const containers = /Initial Number of Containers:\s*(\d+)/i.exec(text);

  // Appendix A fee row: "<count> $<rate> $<subtotal> State: 8.6%" or "... N/A".
  const row = /Total:\s*(\d+)\s+\$([\d,.]+)\s+\$([\d,.]+)\s+(?:(?:State:\s*)?([\d.]+)%|N\/A|-)/i.exec(text);
  const perMove = /Total # of Days\s+Moved/i.test(text) || /Service Fee Per Move/i.test(text);

  const containerCount = containers ? Number(containers[1]) : row && !perMove ? Number(row[1]) : null;
  const rowRate = !perMove ? money(row?.[2]) : null;

  // Appendix B: "Month 4 (10 Units) $12.50 $125", "Month 4 $12.50 $125.00",
  // "Month 1 (Free) - $0", "Month 1-12 $8.00 $2080.00", "Month 12+ (Full Service Fee) ...".
  const ramp: RampStep[] = [];
  const stepPattern = /Month\s+(\d+)(?:\s*-\s*\d+)?\+?\s*(?:\(([^)]+)\))?\s*(\$[\d,.]+|-)\s+\$?(\d[\d,]*(?:\.\d{1,2})?)/gi;
  let rampRate: number | null = null;
  for (let m = stepPattern.exec(text); m; m = stepPattern.exec(text)) {
    const label = (m[2] ?? "").trim();
    const stepRate = m[3] === "-" ? null : money(m[3].slice(1));
    const total = money(m[4]);
    if (stepRate) rampRate = Math.max(rampRate ?? 0, stepRate);
    const named = /(\d+)\s*Units?/i.exec(label);
    const rate = stepRate || rowRate;
    let units: number | null = null;
    let flatCents: number | null = null;
    const free = total === 0;
    if (!free) {
      if (named) units = Number(named[1]);
      else if (rate && total !== null && total % rate === 0) units = total / rate;
      else if (total !== null && !/full/i.test(label)) flatCents = total;
      if (units !== null && units === containerCount) units = null; // the full unit count
    }
    ramp.push({
      month: Number(m[1]),
      label: label || (free ? "Free" : units === null && flatCents === null ? "Full Service Fee" : units !== null ? `${units} Units` : "Flat fee"),
      free,
      units,
      totalCents: total,
      ...(flatCents !== null ? { flatCents } : {}),
    });
  }
  // A "Full" month whose fee is not units x rate (for example 36 x $22.22 against $800.00) is billed flat.
  const fullStep = ramp.find((r) => !r.free && r.units === null);
  if (fullStep && fullStep.totalCents !== null && containerCount && (rowRate ?? rampRate) && containerCount * (rowRate ?? rampRate ?? 0) !== fullStep.totalCents) {
    for (const r of ramp) if (!r.free && r.units === null) r.flatCents = r.totalCents;
  }

  const headline = /Total Monthly Service Fee:\s*\$([\d,]+(?:\.\d{1,2})?)/i.exec(text);
  const lateFee = /late fee payment of [a-z\s-]*\((\d+(?:\.\d+)?)%\)/i.exec(text);
  const days = /within [a-z\s-]*\((\d+)\) days of\s+receipt/i.exec(text);
  const property = /Property Address:\s*(.+?)\s*(?=Phone No|Billing Address:|Property Management|Summary of|Term:|$)/i.exec(text);
  const billing = /Billing Address:\s*(.+?Zip:\s*\d{5})/i.exec(text);
  const tidy = (s: string | undefined) => (s ? s.replace(/\s*\|\s*/g, ", ").replace(/\s+(City|State|Zip):\s*/g, ", ").replace(/,\s*,/g, ",").trim().slice(0, 160) : null);

  const noticeDays = /Notice of rate changes shall be sent (\d+) days prior/i.exec(text);
  const noticeMonths = /Notice of rate changes shall be sent (\d+) months prior/i.exec(text);
  const cap = /(?:not to exceed|no greater than)[a-z\s]*\(?(\d+(?:\.\d+)?)%\)?/i.exec(text);

  const isPerUnit = !perMove && (ramp.length > 0 || containers !== null);
  return {
    kind: isPerUnit ? "per_unit" : row || headline ? "flat" : "unknown",
    termYears,
    commencement: term ? parseLongDate(term[3]) : null,
    unitCount: isPerUnit ? containerCount : null,
    ratePerUnitCents: isPerUnit ? (rowRate ?? rampRate) : null,
    // The fee row's subtotal is before tax; the headline figure may include tax.
    monthlyFeeCents: money(row?.[3]) ?? money(headline?.[1]),
    ramp,
    lateFeePercent: lateFee ? lateFee[1] : null,
    paymentDays: days ? Number(days[1]) : null,
    taxPercent: row?.[4] ?? null,
    propertyAddress: tidy(property?.[1]),
    billingAddress: tidy(billing?.[1]),
    rateNoticeDays: noticeDays ? Number(noticeDays[1]) : noticeMonths ? Number(noticeMonths[1]) * 30 : null,
    rateCapPercent: cap ? cap[1] : null,
  };
}
