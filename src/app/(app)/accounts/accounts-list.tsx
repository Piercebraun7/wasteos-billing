"use client";

import Link from "next/link";
import { useState } from "react";
import { Empty, Monogram } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { formatCents } from "@/lib/money";

export type AccountRow = {
  account_id: string;
  status: string;
  property_name: string;
  unit_count: number | null;
  customer_id: string;
  customer_name: string;
  balance_cents: number;
  oldest_open_due_date: string | null;
};
export type ContactRow = { account_id: string; name: string; email: string };

export function AccountsList({ rows, contacts }: { rows: AccountRow[]; contacts: ContactRow[] }) {
  const [search, setSearch] = useState("");
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  const contactsFor = (id: string) => contacts.filter((c) => c.account_id === id);
  const shown = rows.filter((r) => {
    const people = contactsFor(r.account_id).map((c) => `${c.name} ${c.email}`).join(" ");
    const haystack = `${r.property_name} ${r.customer_name} ${people}`.toLowerCase();
    return words.every((w) => haystack.includes(w));
  });

  // Client, then its properties.
  const clients = new Map<string, { name: string; rows: AccountRow[] }>();
  for (const r of shown) {
    const group = clients.get(r.customer_id) ?? { name: r.customer_name, rows: [] };
    group.rows.push(r);
    clients.set(r.customer_id, group);
  }
  const groups = [...clients.values()].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <>
      <div className="relative">
        <svg viewBox="0 0 24 24" className="pointer-events-none absolute left-4 top-1/2 size-[18px] -translate-y-1/2 text-slate-400" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search client, property, or contact"
          aria-label="Search clients and properties"
          className="h-12 w-full rounded-full border border-line bg-white pl-11 pr-28 text-[15px] text-ink outline-none transition placeholder:text-slate-400 focus:border-ink focus:ring-4 focus:ring-ink/10"
        />
        <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 font-mono text-[11px] uppercase tracking-[0.14em] text-mute">
          {shown.length} of {rows.length}
        </span>
      </div>

      {shown.length === 0 && (
        <Empty>{rows.length === 0 ? "No clients yet. Click New Property to add the first one." : "Nothing matches that search."}</Empty>
      )}

      {groups.map((group) => {
        const total = group.rows.reduce((sum, r) => sum + Number(r.balance_cents), 0);
        const units = group.rows.reduce((sum, r) => sum + (r.unit_count ?? 0), 0);
        return (
          <section key={group.name} className="overflow-hidden rounded-3xl border border-line bg-white shadow-[0_1px_2px_rgb(16_24_40/0.04)]">
            <header className="flex flex-wrap items-end justify-between gap-3 border-b border-line bg-slate-50/70 px-4 py-4 sm:px-6">
              <div>
                <p className="font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-mute">Client</p>
                <h2 className="mt-1 text-xl font-semibold tracking-tight text-ink">{group.name}</h2>
                <p className="text-sm text-mute">
                  {group.rows.length} {group.rows.length === 1 ? "property" : "properties"}
                  {units > 0 && ` · ${units.toLocaleString("en-US")} units`}
                </p>
              </div>
              <div className="text-right">
                <p className="font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-mute">Client balance</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-ink">{formatCents(total)}</p>
              </div>
            </header>
            <ul className="divide-y divide-line">
              {group.rows.map((r) => {
                const people = contactsFor(r.account_id);
                return (
                  <li key={r.account_id}>
                    <Link href={`/accounts/${r.account_id}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 py-4 transition hover:bg-slate-50 sm:px-6">
                      <div className="flex min-w-0 items-center gap-4">
                        <Monogram name={r.property_name} />
                        <div className="min-w-0">
                          <p className="truncate font-medium text-ink">
                            {r.property_name}
                            {r.unit_count !== null && <span className="font-normal text-mute"> · {r.unit_count} units</span>}
                            {r.status !== "active" && (
                              <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-mute">Inactive</span>
                            )}
                          </p>
                          <p className="truncate text-sm text-mute">
                            {people.length === 0 ? (
                              <span className="text-amber-700">No point of contact yet</span>
                            ) : (
                              <>Invoices go to {people.map((c) => c.name).join(", ")}</>
                            )}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-[17px] font-semibold tabular-nums text-ink">{formatCents(Number(r.balance_cents))}</p>
                        <p className="text-xs text-mute">{r.oldest_open_due_date ? `Oldest due ${formatDate(r.oldest_open_due_date)}` : "Nothing open"}</p>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </>
  );
}
