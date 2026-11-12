// Calendar-date helpers. Dates are plain "YYYY-MM-DD" text, so no time zone
// (and no daylight saving rule) can ever shift a day.

export type ISODate = string;

const pad = (n: number) => String(n).padStart(2, "0");

export function parts(date: ISODate): { y: number; m: number; d: number } {
  const [y, m, d] = date.slice(0, 10).split("-").map(Number);
  return { y, m, d };
}

export function iso(y: number, m: number, d: number): ISODate {
  return `${y}-${pad(m)}-${pad(d)}`;
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** First day of the month containing the date. */
export function monthStart(date: ISODate): ISODate {
  const { y, m } = parts(date);
  return iso(y, m, 1);
}

/** Last day of the month containing the date. */
export function monthEnd(date: ISODate): ISODate {
  const { y, m } = parts(date);
  return iso(y, m, daysInMonth(y, m));
}

export function addDays(date: ISODate, days: number): ISODate {
  const { y, m, d } = parts(date);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "2026-11-01" -> "November 2026". */
export function monthLabel(date: ISODate): string {
  const { y, m } = parts(date);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

/** "2026-11-05" -> "Nov 5". */
export function shortDay(date: ISODate): string {
  const { m, d } = parts(date);
  return `${MONTH_NAMES[m - 1].slice(0, 3)} ${d}`;
}

/** Today's date in Phoenix (UTC minus 7 all year, no daylight saving). */
export function todayInPhoenix(now: Date = new Date()): ISODate {
  const t = new Date(now.getTime() - 7 * 60 * 60 * 1000);
  return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** The first given weekday of a month (0 is Sunday, 1 is Monday). */
export function firstWeekdayOfMonth(month: ISODate, weekday: number): ISODate {
  const { y, m } = parts(month);
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  return iso(y, m, 1 + ((weekday - first + 7) % 7));
}
