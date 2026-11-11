import Link from "next/link";
import { Empty, Notice, PageHeader, primaryButton, secondaryButton } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { todayInPhoenix } from "@/lib/billing/dates";
import type { BillingModel, Phase } from "@/lib/billing/invoice-math";
import { monthsOfYear, scheduleCell, type ScheduleCell } from "@/lib/billing/schedule";
import { formatCents } from "@/lib/money";
import { toggleBilling } from "../accounts/actions";

type Row = {
  id: string;
  go_live_service_month: string | null;
  property: { name: string; unit_count: number | null };
  customer: { id: string; name: string };
  contracts: { status: string; billing_model: BillingModel; start_date: string | null; end_date: string | null; created_at: string; contract_file_path: string | null; phases: Phase[] }[];
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const GRID = "grid grid-cols-[15rem_repeat(12,minmax(5.6rem,1fr))_7rem]";

/** "$1,862.50" -> "$1,862.50"; whole dollars drop the cents to keep cells calm. */
const compact = (cents: number) => (cents % 100 === 0 ? formatCents(cents).slice(0, -3) : formatCents(cents));

export default async function SchedulePage({ searchParams }: { searchParams: Promise<{ year?: string; saved?: string; error?: string }> }) {
  const { supabase } = await requireAdmin();
  const today = todayInPhoenix();
  const thisMonth = `${today.slice(0, 7)}-01`;
  const query = await searchParams;
  const wanted = Number(query.year);
  const year = Number.isInteger(wanted) && wanted > 2000 && wanted < 2100 ? wanted : Number(today.slice(0, 4));
  const months = monthsOfYear(year);

  const [accounts, invoices] = await Promise.all([
    supabase
      .from("billing_accounts")
      .select("id, go_live_service_month, property:properties(name, unit_count), customer:customers(id, name), contracts(status, billing_model, start_date, end_date, created_at, contract_file_path, phases:contract_phases(*))")
      .eq("status", "active"),
    supabase.from("invoices").select("account_id, service_month, total_cents, status").gte("service_month", months[0]).lte("service_month", months[11]).neq("status", "void"),
  ]);
  const rows = ((accounts.data ?? []) as unknown as Row[]).sort(
    (a, b) => a.customer.name.localeCompare(b.customer.name) || a.property.name.localeCompare(b.property.name),
  );
  const invoiced = new Map((invoices.data ?? []).map((i) => [`${i.account_id}:${i.service_month}`, i]));

  const built = rows.map((row) => {
    const contract = row.contracts.find((c) => c.status === "active") ?? [...row.contracts].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    const cells: ScheduleCell[] = months.map((month) =>
      contract
        ? scheduleCell({ model: contract.billing_model, phases: contract.phases, month, contractStart: contract.start_date, contractEnd: contract.end_date })
        : { month, amountCents: null, units: null, free: false, partial: false, phaseStarts: false },
    );
    const peak = Math.max(1, ...cells.map((c) => c.amountCents ?? 0));
    return { row, contract, cells, peak, total: cells.reduce((sum, c) => sum + (c.amountCents ?? 0), 0) };
  });
  const columnTotals = months.map((_, i) => built.reduce((sum, b) => sum + (b.cells[i].amountCents ?? 0), 0));
  const yearTotal = columnTotals.reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Planning"
        title="Schedule of billing"
        description="What every property is contracted to be billed each month, worked out from its phases by the same math that drafts the invoices."
        action={<Link href="/accounts/new?next=schedule" className={primaryButton}>Launch a property</Link>}
      />
      {query.saved && <Notice kind="ok">{query.saved}</Notice>}
      {query.error && <Notice kind="error">{query.error}</Notice>}
      {accounts.error && <Notice kind="error">Could not load the schedule: {accounts.error.message}</Notice>}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link href={`/schedule?year=${year - 1}`} className={secondaryButton} aria-label="Previous year">&larr;</Link>
          <span className="font-display min-w-20 text-center text-2xl font-extrabold tabular-nums text-ink">{year}</span>
          <Link href={`/schedule?year=${year + 1}`} className={secondaryButton} aria-label="Next year">&rarr;</Link>
        </div>
        <ul className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-mute">
          <li className="flex items-center gap-1.5"><span className="size-3 rounded bg-tomato/25" /> Scheduled</li>
          <li className="flex items-center gap-1.5"><span className="size-3 rounded bg-ice ring-1 ring-sky-200" /> Free month</li>
          <li className="flex items-center gap-1.5"><span className="size-3 rounded border border-dashed border-slate-400" /> Partial month</li>
          <li className="flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-tomato" /> Rate or unit change</li>
          <li className="flex items-center gap-1.5"><span className="font-semibold text-emerald-600">&#10003;</span> Invoiced</li>
        </ul>
      </div>

      {built.length === 0 ? (
        <Empty>No properties yet. Click Launch a property to add the first one.</Empty>
      ) : (
        <div className="overflow-x-auto rounded-3xl border border-line bg-white shadow-[0_1px_2px_rgb(16_24_40/0.04)]">
          <div className="min-w-[1180px]">
            <div className={`${GRID} border-b border-line bg-slate-50/80 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-mute`}>
              <div className="sticky left-0 z-10 flex justify-between bg-slate-50 py-3 pl-5 pr-2"><span>Property</span><span>Billing</span></div>
              {months.map((m, i) => (
                <div key={m} className={`px-2 py-3 text-right ${m === thisMonth ? "text-ink" : ""}`}>
                  {m === thisMonth && <span className="mr-1 inline-block size-1.5 rounded-full bg-tomato align-middle" aria-hidden />}
                  {MONTHS[i]}
                </div>
              ))}
              <div className="px-4 py-3 text-right">{year} total</div>
            </div>

            {built.map(({ row, contract, cells, peak, total }, index) => {
              const newClient = index === 0 || built[index - 1].row.customer.id !== row.customer.id;
              const live = contract?.status === "active";
              return (
                <div key={row.id}>
                  {newClient && (
                    <div className="border-b border-line bg-ink px-5 py-2 font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-white/70">
                      <span className="sticky left-5">{row.customer.name}</span>
                    </div>
                  )}
                  <div className={`${GRID} group border-b border-line`}>
                    <div className="sticky left-0 z-10 flex items-center justify-between gap-2 bg-white py-3 pl-5 pr-2 transition group-hover:bg-slate-50">
                      <Link href={`/schedule/${row.id}`} className="min-w-0">
                        <span className="block truncate font-medium text-ink">{row.property.name}</span>
                        <span className="block truncate text-xs text-mute">
                          {row.property.unit_count != null && row.property.unit_count > 0 && `${row.property.unit_count} units`}
                          {!contract?.contract_file_path && `${row.property.unit_count ? " · " : ""}no contract file`}
                        </span>
                      </Link>
                      <form action={toggleBilling}>
                        <input type="hidden" name="account_id" value={row.id} />
                        <input type="hidden" name="turn" value={live ? "off" : "on"} />
                        <input type="hidden" name="return_to" value={`/schedule?year=${year}`} />
                        <button
                          title={live ? "Billing is on. Click to turn it off." : "Billing is off. Click to turn it on."}
                          aria-label={`Billing for ${row.property.name} is ${live ? "on" : "off"}. Click to switch.`}
                          className={`flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition ${live ? "justify-end bg-emerald-500" : "justify-start bg-slate-300"}`}
                        >
                          <span className="size-5 rounded-full bg-white shadow" />
                        </button>
                      </form>
                    </div>
                    {cells.map((cell) => {
                      const invoice = invoiced.get(`${row.id}:${cell.month}`);
                      const billable = live && row.go_live_service_month !== null && cell.month >= row.go_live_service_month;
                      const strength = cell.amountCents ? 0.06 + 0.2 * (cell.amountCents / peak) : 0;
                      return (
                        <div key={cell.month} className={`p-1 ${cell.month === thisMonth ? "bg-slate-50" : ""}`}>
                          {cell.amountCents === null ? (
                            <div className="flex h-12 items-center justify-end px-2 text-slate-300">&middot;</div>
                          ) : (
                            <div
                              className={`relative flex h-12 flex-col items-end justify-center rounded-lg px-2 ${cell.free ? "bg-ice" : ""} ${cell.partial ? "border border-dashed border-slate-400" : ""}`}
                              style={cell.free ? undefined : { backgroundColor: `rgb(255 75 55 / ${strength.toFixed(3)})` }}
                              title={`${row.property.name}, ${MONTHS[Number(cell.month.slice(5, 7)) - 1]} ${year}: ${formatCents(cell.amountCents)}${invoice ? `, invoiced ${formatCents(Number(invoice.total_cents))}` : ""}`}
                            >
                              {cell.phaseStarts && <span className="absolute left-1.5 top-1.5 size-1.5 rounded-full bg-tomato" aria-hidden />}
                              <span className={`text-[13px] font-semibold tabular-nums ${billable || invoice ? "text-ink" : "text-slate-500"}`}>
                                {invoice && <span className="mr-1 text-emerald-600">&#10003;</span>}
                                {cell.free ? "Free" : compact(invoice ? Number(invoice.total_cents) : cell.amountCents)}
                              </span>
                              {cell.units !== null && !cell.free && <span className="text-[10px] leading-tight text-mute">{cell.units} units</span>}
                            </div>
                          )}
                        </div>
                      );
                    })}
                    <div className="flex items-center justify-end px-4 text-[13px] font-semibold tabular-nums text-ink">{compact(total)}</div>
                  </div>
                </div>
              );
            })}

            <div className={`${GRID} bg-ink text-white`}>
              <div className="sticky left-0 z-10 bg-ink px-5 py-4 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-white/60">Scheduled total</div>
              {columnTotals.map((t, i) => (
                <div key={i} className="px-2 py-4 text-right text-[13px] font-semibold tabular-nums">{t ? compact(t) : ""}</div>
              ))}
              <div className="font-display px-4 py-4 text-right text-[15px] font-extrabold tabular-nums">{compact(yearTotal)}</div>
            </div>
          </div>
        </div>
      )}
      <p className="text-xs text-mute">
        Use the switch beside a property to turn its billing on or off. Grey amounts will not be invoiced by this app: the property is off, or the month is before its first month here. Click a property name to see its contract and schedule.
      </p>
    </div>
  );
}
