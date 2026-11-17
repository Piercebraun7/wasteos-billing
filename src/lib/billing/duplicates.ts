/**
 * Finds invoices that look like the same bill made twice.
 *
 * A duplicate: same property, same invoice date, same total. It does not
 * matter where either came from, including QuickBooks. Only one of them may
 * ever be approved, so only one can be sent.
 *
 * A look-alike: same property, same service, same service month and same
 * total, but on a different day. That can be real (two bulk pickups in a
 * month at the same price), so it is pointed out and never blocked.
 *
 * Voided invoices are never counted.
 */
export type DupeRow = {
  id: string; account_id: string; invoice_number: number | null; status: string; origin: string;
  service_category: string | null; service_month: string; invoice_date: string; total_cents: number;
  /** Set on a late fee: the invoice it is a fee on. Two fees for two different invoices are never duplicates of each other. */
  late_fee_for?: string | null;
};

function grouped(rows: DupeRow[], keyOf: (r: DupeRow) => string | null): Map<string, DupeRow[]> {
  const groups = new Map<string, DupeRow[]>();
  for (const r of rows) {
    if (r.status === "void" || Number(r.total_cents) === 0) continue;
    const key = keyOf(r);
    if (key) groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const out = new Map<string, DupeRow[]>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    for (const r of group) out.set(r.id, group.filter((o) => o.id !== r.id));
  }
  return out;
}

const dayKey = (r: DupeRow) => `${r.account_id}|${r.invoice_date}|${Number(r.total_cents)}|${r.late_fee_for ?? ""}`;

/** Same property, same invoice date, same total. */
export function possibleDuplicates(rows: DupeRow[]): Map<string, DupeRow[]> {
  return grouped(rows, dayKey);
}

/** Same property, service, month and total on a different day. A heads-up only. */
export function lookAlikes(rows: DupeRow[]): Map<string, DupeRow[]> {
  const sameMonth = grouped(rows, (r) => (r.origin === "app" && !r.late_fee_for ? `${r.account_id}|${r.service_category ?? ""}|${r.service_month}|${Number(r.total_cents)}` : null));
  const out = new Map<string, DupeRow[]>();
  for (const [id, others] of sameMonth) {
    const me = rows.find((r) => r.id === id)!;
    const otherDays = others.filter((o) => o.invoice_date !== me.invoice_date);
    if (otherDays.length) out.set(id, otherDays);
  }
  return out;
}

/** The already issued invoice that stops a draft from being approved, if there is one. */
export function blockingTwin(draft: DupeRow, rows: DupeRow[]): DupeRow | null {
  return rows.find((r) => r.id !== draft.id && r.status !== "void" && r.status !== "draft" && Number(r.total_cents) !== 0 && dayKey(r) === dayKey(draft)) ?? null;
}

/** "invoice 2004" or "another draft", for a short label. */
export function describeTwin(row: DupeRow): string {
  return row.invoice_number ? `invoice ${row.invoice_number}` : "another draft";
}
