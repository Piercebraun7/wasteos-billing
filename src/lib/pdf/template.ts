/** The blocks an invoice template can switch on or off, in the order they print. */
export const BLOCKS = [
  { key: "managementCompany", label: "Management company", help: "Under the property name in the Bill to box." },
  { key: "reference", label: "Customer account or PO number", help: "Prints only for properties that have one entered below." },
  { key: "serviceDates", label: "Exact service dates", help: "November 1 to November 30, 2026, in place of the month name alone." },
  { key: "contact", label: "Kaizen phone and email", help: "In the From box and the footer." },
  { key: "outstanding", label: "Outstanding balance", help: "Earlier unpaid invoices, late fees, and recent payments." },
  { key: "check", label: "Pay by check", help: "Who to make the check out to and where to mail it." },
  { key: "ach", label: "Pay by ACH", help: "Your bank details. Prints only once they are entered on this page." },
  { key: "nextMonth", label: "Next month, scheduled", help: "What the following month is expected to be." },
  { key: "lateFeeTerms", label: "Late fee terms", help: "The late fee sentence in the footer." },
] as const;

export type BlockKey = (typeof BLOCKS)[number]["key"];
export type TemplateOptions = Record<BlockKey, boolean> & { note: string };

export const DEFAULT_OPTIONS: TemplateOptions = {
  managementCompany: true, reference: true, serviceDates: true, contact: true, outstanding: true,
  check: true, ach: true, nextMonth: true, lateFeeTerms: true, note: "",
};

/** Reads stored options, filling anything missing with the standard choice. */
export function resolveOptions(stored: unknown): TemplateOptions {
  const o = (stored && typeof stored === "object" ? stored : {}) as Record<string, unknown>;
  const out = { ...DEFAULT_OPTIONS };
  for (const b of BLOCKS) if (typeof o[b.key] === "boolean") out[b.key] = o[b.key] as boolean;
  if (typeof o.note === "string") out.note = o.note.trim().slice(0, 600);
  return out;
}
