/**
 * Finds invoices that look like the same bill made twice. Two rules:
 *   1. Same property, same service, same service month, same total (both made in this app).
 *   2. Same property, same invoice date, same total (from anywhere, including QuickBooks).
 * Voided invoices are never counted. This only points things out: a person decides.
 */
export type DupeRow = {
  id: string; account_id: string; invoice_number: number | null; status: string; origin: string;
  service_category: string | null; service_month: string; invoice_date: string; total_cents: number;
};

export function possibleDuplicates(rows: DupeRow[]): Map<string, DupeRow[]> {
  const live = rows.filter((r) => r.status !== "void" && Number(r.total_cents) !== 0);
  const groups = new Map<string, DupeRow[]>();
  const add = (key: string, row: DupeRow) => groups.set(key, [...(groups.get(key) ?? []), row]);
  for (const r of live) {
    if (r.origin === "app") add(`month|${r.account_id}|${r.service_category ?? ""}|${r.service_month}|${Number(r.total_cents)}`, r);
    add(`day|${r.account_id}|${r.invoice_date}|${Number(r.total_cents)}`, r);
  }
  const out = new Map<string, DupeRow[]>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    for (const r of group) {
      const others = group.filter((o) => o.id !== r.id && !(out.get(r.id) ?? []).some((x) => x.id === o.id));
      out.set(r.id, [...(out.get(r.id) ?? []), ...others]);
    }
  }
  return out;
}

/** "invoice 2004" or "another draft", for a short label. */
export function describeTwin(row: DupeRow): string {
  return row.invoice_number ? `invoice ${row.invoice_number}` : "another draft";
}
