// All money is integer cents. These helpers never use floating point.

/** "$1,234.5" -> 123450. Returns null for anything that is not a valid, non-negative dollar amount. */
export function parseDollarsToCents(input: string): number | null {
  const cleaned = input.trim().replace(/[$,\s]/g, "");
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) return null;
  const cents = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}

/** 123450 -> "$1,234.50"; -500 -> "-$5.00". */
export function formatCents(cents: number): string {
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100).toLocaleString("en-US");
  const rest = String(abs % 100).padStart(2, "0");
  return `${cents < 0 ? "-" : ""}$${dollars}.${rest}`;
}

/** 123450 -> "1234.50", for prefilling an input. */
export function centsToInput(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "";
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

/** Percent typed by a person ("3", "1.5") -> basis points (300, 150). */
export function parsePercentToBps(input: string): number | null {
  const cleaned = input.trim().replace(/[%\s]/g, "");
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}

/** 150 -> "1.5"; 300 -> "3". */
export function bpsToInput(bps: number | null | undefined): string {
  if (bps === null || bps === undefined) return "";
  const whole = Math.floor(bps / 100);
  const frac = String(bps % 100).padStart(2, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : String(whole);
}

/** Like parseDollarsToCents, but a leading minus is allowed (for a discount line). */
export function parseSignedDollarsToCents(input: string): number | null {
  const trimmed = input.trim();
  const negative = trimmed.startsWith("-") || /^\(.*\)$/.test(trimmed);
  const cents = parseDollarsToCents(trimmed.replace(/^[-(]\s*/, "").replace(/\)$/, ""));
  return cents === null ? null : negative ? -cents : cents;
}

/** Quantity (up to two decimals) times a rate in cents, rounded half up to the cent. Integer math only. */
export function lineAmountCents(quantity: string, rateCents: number): number | null {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(quantity.trim());
  if (!m) return null;
  const hundredths = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  const raw = Math.abs(rateCents) * hundredths;
  const rounded = Math.floor((2 * raw + 100) / 200);
  return rateCents < 0 ? -rounded : rounded;
}
