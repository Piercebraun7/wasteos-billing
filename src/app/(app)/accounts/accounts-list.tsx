"use client";

import Link from "next/link";
import { useState } from "react";
import { inputClass } from "@/components/ui";
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
      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search property or customer"
        aria-label="Search accounts"
        className={`${inputClass} mt-4`}
      />

      {shown.length === 0 ? (
        <div className="mt-6 rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-slate-500">
          {rows.length === 0 ? "No accounts yet. Click New Account to add the first one." : "No accounts match that search."}
        </div>
      ) : (
        <ul className="mt-6 divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
          {shown.map((r) => (
            <li key={r.account_id}>
              <Link href={`/accounts/${r.account_id}`} className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-slate-50">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-slate-900">{r.property_name}</p>
                  <p className="truncate text-sm text-slate-600">
                    {r.customer_name}
                    {r.unit_count !== null && ` · ${r.unit_count} units`}
                    {r.status !== "active" && " · Inactive"}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-lg font-bold tabular-nums text-slate-900">{formatCents(Number(r.balance_cents))}</p>
                  <p className="text-xs text-slate-500">
                    {r.oldest_open_due_date ? `Oldest due ${formatDate(r.oldest_open_due_date)}` : "Nothing open"}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
