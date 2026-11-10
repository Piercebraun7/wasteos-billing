import Link from "next/link";
import { inputClass, Notice, primaryButton, secondaryButton } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { formatCents } from "@/lib/money";

export const instant = false;

type Row = {
  account_id: string;
  status: string;
  property_name: string;
  unit_count: number | null;
  customer_name: string;
  balance_cents: number;
  oldest_open_due_date: string | null;
};

export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { supabase } = await requireAdmin();
  const q = ((await searchParams).q ?? "").trim();

  let query = supabase.from("account_overview").select("*").order("property_name");
  // Strip characters that have a special meaning in the filter syntax.
  const safe = q.replace(/[^\p{L}\p{N} .'&-]/gu, "");
  if (safe) query = query.or(`property_name.ilike.%${safe}%,customer_name.ilike.%${safe}%`);
  const { data, error } = await query;
  const rows = (data ?? []) as Row[];

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-900">Accounts</h1>
        <Link href="/accounts/new" className={primaryButton}>New Account</Link>
      </div>

      <form className="mt-4 flex gap-2" action="/accounts">
        <input name="q" defaultValue={q} placeholder="Search property or customer" className={inputClass} />
        <button className={secondaryButton}>Search</button>
      </form>

      {error && (
        <div className="mt-4">
          <Notice kind="error">Could not load accounts: {error.message}</Notice>
        </div>
      )}

      {!error && rows.length === 0 && (
        <div className="mt-6 rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-slate-500">
          {q ? "No accounts match that search." : "No accounts yet. Click New Account to add the first one."}
        </div>
      )}

      {rows.length > 0 && (
        <ul className="mt-6 divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
          {rows.map((r) => (
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
