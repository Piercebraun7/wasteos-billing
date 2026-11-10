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
};

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

function parseLongDate(text: string): ISODate | null {
  const m = /([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/.exec(text);
  if (!m) return null;
  const month = MONTHS.indexOf(m[1].toLowerCase());
  return month < 0 ? null : iso(Number(m[3]), month + 1, Number(m[2]));
}

const money = (text: string | undefined) => (text ? parseDollarsToCents(text) : null);

export function parseContractText(raw: string): ScrapedTerms {
  // Collapse line breaks and stray zero-width characters so patterns can span lines.
  const text = raw.replace(/[​‌‍﻿]/g, "").replace(/\s+/g, " ");

  const term = /Term:\s*(\d+)\s*Years?,?\s*Commencing\s+([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i.exec(text);
  const containers = /Initial Number of Containers:\s*(\d+)/i.exec(text);

  // Appendix A fee row: "<count> $<rate> $<subtotal> State: 8.6%" or "... N/A".
  const row = /Total:\s*(\d+)\s+\$([\d,.]+)\s+\$([\d,.]+)\s+(?:State:\s*([\d.]+)%|N\/A)/i.exec(text);
  const perMove = /Total # of Days\s+Moved/i.test(text) || /Service Fee Per Move/i.test(text);

  const ramp: RampStep[] = [];
  const stepPattern = /Month\s+(\d+)\+?\s*\(([^)]+)\)\s*\$([\d,.]+)\s+\$([\d,.]+)/gi;
  for (let m = stepPattern.exec(text); m; m = stepPattern.exec(text)) {
    const label = m[2].trim();
    const units = /(\d+)\s*Units?/i.exec(label);
    ramp.push({
      month: Number(m[1]),
      label,
      free: /free/i.test(label),
      units: units ? Number(units[1]) : null,
      totalCents: money(m[4]),
    });
  }
  const rampRate = /Month\s+\d+\+?\s*\([^)]+\)\s*\$([\d,.]+)/i.exec(text);

  const headline = /Total Monthly Service Fee:\s*\$([\d,]+(?:\.\d{1,2})?)/i.exec(text);
  const lateFee = /late fee payment of [a-z\s-]*\((\d+(?:\.\d+)?)%\)/i.exec(text);
  const days = /within [a-z\s-]*\((\d+)\) days of\s+receipt/i.exec(text);
  const property = /Property Address:\s*(.+?)\s*(?=Phone No|Billing Address:|Property Management|Summary of|Term:|$)/i.exec(text);
  const billing = /Billing Address:\s*(.+?Zip:\s*\d{5})/i.exec(text);
  const tidy = (s: string | undefined) => (s ? s.replace(/\s*\|\s*/g, ", ").replace(/\s+(City|State|Zip):\s*/g, ", ").replace(/,\s*,/g, ",").trim().slice(0, 160) : null);

  const isPerUnit = !perMove && (ramp.length > 0 || containers !== null);
  return {
    kind: isPerUnit ? "per_unit" : row || headline ? "flat" : "unknown",
    termYears: term ? Number(term[1]) : null,
    commencement: term ? parseLongDate(term[2]) : null,
    unitCount: isPerUnit ? (containers ? Number(containers[1]) : row ? Number(row[1]) : null) : null,
    ratePerUnitCents: isPerUnit ? (money(rampRate?.[1]) ?? money(row?.[2])) : null,
    // The fee row's subtotal is before tax; the headline figure may include tax.
    monthlyFeeCents: money(row?.[3]) ?? money(headline?.[1]),
    ramp,
    lateFeePercent: lateFee ? lateFee[1] : null,
    paymentDays: days ? Number(days[1]) : null,
    taxPercent: row?.[4] ?? null,
    propertyAddress: tidy(property?.[1]),
    billingAddress: tidy(billing?.[1]),
  };
}
