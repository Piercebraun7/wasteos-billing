import { addDays } from "./dates";

export type StatInvoice = {
  id: string; invoice_number: number | null; status: string; invoice_date: string; due_date: string;
  total_cents: number; service_category: string | null; kind: string;
};
export type StatPayment = { invoice_id: string; amount_cents: number; date: string };
export type StatCredit = { invoice_id: string | null; amount_cents: number; date: string };

export type InvoiceLine = StatInvoice & { paidCents: number; creditedCents: number; openCents: number; overdue: boolean; lastPaidOn: string | null; state: "Paid" | "Overdue" | "Partly paid" | "Open" | "Not sent yet" | "Void" };

export type AccountStats = {
  invoices: InvoiceLine[];
  outstandingCents: number;
  overdueCents: number;
  openByService: Record<string, number>;
  billed12Cents: number;
  paid12Cents: number;
  /** Of invoices paid in full, the share paid on or before the due date. Null when none are paid yet. */
  onTimePercent: number | null;
  paidInFull: number;
  lastPayment: { date: string; amountCents: number } | null;
};

/** Everything the Accounts page shows about one property, worked out from its invoices, payments and credits. */
export function accountStats(invoices: StatInvoice[], payments: StatPayment[], credits: StatCredit[], today: string): AccountStats {
  const yearAgo = addDays(today, -365);
  const posted = invoices.filter((i) => i.status !== "draft");
  const lines: InvoiceLine[] = posted.map((i) => {
    const mine = payments.filter((p) => p.invoice_id === i.id);
    const paidCents = mine.reduce((s, p) => s + Number(p.amount_cents), 0);
    const creditedCents = credits.filter((c) => c.invoice_id === i.id).reduce((s, c) => s + Number(c.amount_cents), 0);
    const total = Number(i.total_cents);
    const openCents = i.status === "void" ? 0 : Math.max(0, total - paidCents - creditedCents);
    const overdue = openCents > 0 && i.due_date < today && i.status !== "approved";
    const lastPaidOn = mine.map((p) => p.date).sort().at(-1) ?? null;
    const state: InvoiceLine["state"] =
      i.status === "void" ? "Void" : openCents === 0 ? "Paid" : overdue ? "Overdue" : openCents < total ? "Partly paid" : i.status === "approved" ? "Not sent yet" : "Open";
    return { ...i, total_cents: total, paidCents, creditedCents, openCents, overdue, lastPaidOn, state };
  }).sort((a, b) => b.invoice_date.localeCompare(a.invoice_date) || Number(b.invoice_number ?? 0) - Number(a.invoice_number ?? 0));

  const live = lines.filter((l) => l.status !== "void");
  const openByService: Record<string, number> = {};
  for (const l of live) if (l.openCents > 0) openByService[l.service_category ?? "other"] = (openByService[l.service_category ?? "other"] ?? 0) + l.openCents;

  const settled = live.filter((l) => l.openCents === 0 && l.paidCents > 0 && l.lastPaidOn);
  const onTime = settled.filter((l) => l.lastPaidOn! <= l.due_date).length;
  const latest = [...payments].sort((a, b) => b.date.localeCompare(a.date))[0];
  const sameDay = latest ? payments.filter((p) => p.date === latest.date).reduce((s, p) => s + Number(p.amount_cents), 0) : 0;

  return {
    invoices: lines,
    outstandingCents: live.reduce((s, l) => s + l.openCents, 0),
    overdueCents: live.filter((l) => l.overdue).reduce((s, l) => s + l.openCents, 0),
    openByService,
    billed12Cents: live.filter((l) => l.invoice_date >= yearAgo).reduce((s, l) => s + l.total_cents, 0),
    paid12Cents: payments.filter((p) => p.date >= yearAgo).reduce((s, p) => s + Number(p.amount_cents), 0),
    onTimePercent: settled.length ? Math.round((100 * onTime) / settled.length) : null,
    paidInFull: settled.length,
    lastPayment: latest ? { date: latest.date, amountCents: sameDay } : null,
  };
}
