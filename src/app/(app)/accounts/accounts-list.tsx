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
  customer_name: string;
  balance_cents: number;
  oldest_open_due_date: string | null;
};

export function AccountsList({ rows }: { rows: AccountRow[] }) {
  const [search, setSearch] = useState("");
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = rows.filter((r) => {
    const haystack = `${r.property_name} ${r.customer_name}`.toLowerCase();
    return words.every((w) => haystack.includes(w));
  });

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
          placeholder="Search property or customer"
          aria-label="Search accounts"
          className="h-12 w-full rounded-full border border-line bg-white pl-11 pr-28 text-[15px] text-ink outline-none transition placeholder:text-slate-400 focus:border-ink focus:ring-4 focus:ring-ink/10"
        />
        <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 font-mono text-[11px] uppercase tracking-[0.14em] text-mute">
          {shown.length} of {rows.length}
        </span>
      </div>

      {shown.length === 0 ? (
        <Empty>{rows.length === 0 ? "No accounts yet. Click New Account to add the first one." : "No accounts match that search."}</Empty>
      ) : (
        <div className="overflow-hidden rounded-3xl border border-line bg-white shadow-[0_1px_2px_rgb(16_24_40/0.04)]">
          <div className="hidden grid-cols-[minmax(0,2.2fr)_minmax(0,1.4fr)_5rem_9rem_9rem] gap-4 border-b border-line px-6 py-3 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-mute md:grid">
            <span>Property</span>
            <span>Billed to</span>
            <span className="text-right">Units</span>
            <span className="text-right">Oldest due</span>
            <span className="text-right">Balance</span>
          </div>
          <ul className="divide-y divide-line">
            {shown.map((r) => (
              <li key={r.account_id}>
                <Link
                  href={`/accounts/${r.account_id}`}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 py-4 transition hover:bg-slate-50 sm:px-6 md:grid-cols-[minmax(0,2.2fr)_minmax(0,1.4fr)_5rem_9rem_9rem]"
                >
                  <div className="flex min-w-0 items-center gap-4">
                    <Monogram name={r.property_name} />
                    <div className="min-w-0">
                      <p className="truncate font-medium text-ink">
                        {r.property_name}
                        {r.status !== "active" && (
                          <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-mute">Inactive</span>
                        )}
                      </p>
                      <p className="truncate text-sm text-mute md:hidden">
                        {r.customer_name}
                        {r.unit_count !== null && ` · ${r.unit_count} units`}
                      </p>
                    </div>
                  </div>
                  <p className="hidden truncate text-[15px] text-slate-600 md:block">{r.customer_name}</p>
                  <p className="hidden text-right text-[15px] tabular-nums text-slate-600 md:block">{r.unit_count ?? ""}</p>
                  <p className="hidden text-right text-sm text-mute md:block">
                    {r.oldest_open_due_date ? formatDate(r.oldest_open_due_date) : "Nothing open"}
                  </p>
                  <p className="text-right text-[17px] font-semibold tabular-nums text-ink">{formatCents(Number(r.balance_cents))}</p>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
