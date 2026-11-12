import Link from "next/link";
import { SubmitButton } from "@/components/submit-button";
import { Empty, Notice, PageHeader, primaryButton, secondaryButton } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { todayInPhoenix } from "@/lib/billing/dates";
import { divideRoundHalfUp, rateFor, type BillingModel, type EventRate, type Phase } from "@/lib/billing/invoice-math";
import { monthsOfYear, scheduleCell } from "@/lib/billing/schedule";
import { formatCents, lineAmountCents } from "@/lib/money";
import { categoryOfModel, isServiceCategory, SERVICE_ORDER, SERVICES, type ServiceCategory } from "@/lib/services";
import { toggleBilling, turnOnAllBilling } from "../accounts/actions";

type Contract = {
  id: string;
  status: string;
  billing_model: BillingModel;
  service_category: ServiceCategory | null;
  expected_monthly_cents: number | null;
  start_date: string | null;
  created_at: string;
  contract_file_path: string | null;
  phases: Phase[];
  event_rates: EventRate[];
};
type Account = {
  id: string;
  go_live_service_month: string | null;
  property: { name: string; unit_count: number | null };
  customer: { id: string; name: string };
  contracts: Contract[];
};
type Cell = { month: string; amountCents: number | null; units: number | null; free: boolean; partial: boolean; phaseStarts: boolean; estimate: boolean };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const GRID = "grid grid-cols-[16.5rem_repeat(12,minmax(5.6rem,1fr))_7rem]";
const compact = (cents: number) => (cents % 100 === 0 ? formatCents(cents).slice(0, -3) : formatCents(cents));

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; service?: string; saved?: string; error?: string }>;
}) {
  const { supabase } = await requireAdmin();
  const query = await searchParams;
  const today = todayInPhoenix();
  const thisMonth = `${today.slice(0, 7)}-01`;
  const wanted = Number(query.year);
  const year = Number.isInteger(wanted) && wanted > 2000 && wanted < 2100 ? wanted : Number(today.slice(0, 4));
  const months = monthsOfYear(year);
  const view: ServiceCategory | "all" = isServiceCategory(query.service) ? query.service : "all";

  const [recurringRes, recurringInvoices, accounts, invoices, events] = await Promise.all([
    supabase.from("recurring_invoices").select("*").eq("status", "active"),
    supabase.from("invoices").select("recurring_invoice_id, service_month, total_cents").not("recurring_invoice_id", "is", null).gte("service_month", months[0]).lte("service_month", months[11]).neq("status", "void"),
    supabase
      .from("billing_accounts")
      .select("id, go_live_service_month, property:properties(name, unit_count), customer:customers(id, name), contracts(*, phases:contract_phases(*), event_rates:contract_event_rates(*))")
      .eq("status", "active"),
    supabase.from("invoices").select("account_id, service_month, service_category, total_cents, status").eq("kind", "scheduled").gte("service_month", months[0]).lte("service_month", months[11]).neq("status", "void"),
    supabase.from("billable_events").select("id, account_id, event_date, event_type, time_window, quantity, rate_cents, description").neq("status", "rejected").gte("event_date", months[0]).lte("event_date", `${year}-12-31`),
  ]);
  const recurringInvoiced = new Map((recurringInvoices.data ?? []).map((i) => [`${i.recurring_invoice_id}:${i.service_month}`, i]));
  const list = ((accounts.data ?? []) as unknown as Account[]).sort(
    (a, b) => a.customer.name.localeCompare(b.customer.name) || a.property.name.localeCompare(b.property.name),
  );
  const invoiced = new Map((invoices.data ?? []).map((i) => [`${i.account_id}:${i.service_category ?? ""}:${i.service_month}`, i]));

  const hasRecurring = (accountId: string, category: string) =>
    ((recurringRes.data ?? []) as { account_id: string; service_category: string }[]).some((r) => r.account_id === accountId && r.service_category === category);

  // One row per property, per service.
  const rows = list.flatMap((account) => {
    const contracts = account.contracts.filter((c) => c.status !== "ended").sort((a, b) => a.created_at.localeCompare(b.created_at));
    const perContract = contracts.map((contract, index) => {
      const category = contract.service_category ?? categoryOfModel(contract.billing_model);
      const eventBased = contract.billing_model === "per_event" || contract.billing_model === "as_needed";
      const cells: Cell[] = months.map((month) => {
        if (!eventBased) {
          return { ...scheduleCell({ model: contract.billing_model, phases: contract.phases, month, contractStart: contract.start_date }), estimate: false };
        }
        // Billed from logged work: show what was logged, or the usual month as an estimate.
        const logged = (events.data ?? []).filter((e) => e.account_id === account.id && String(e.event_date).slice(0, 7) === month.slice(0, 7));
        let sum = 0;
        let any = false;
        for (const e of logged) {
          const rate = rateFor({ ...e, quantity: Number(e.quantity) }, contract.event_rates);
          if (rate === null) continue;
          any = true;
          sum += divideRoundHalfUp(rate * Math.round(Number(e.quantity) * 100), 100);
        }
        const started = !contract.start_date || month >= `${contract.start_date.slice(0, 7)}-01`;
        // A recurring invoice for the same service already shows the usual month, so no estimate is added on top.
        const estimate = !any && started && month >= thisMonth && contract.expected_monthly_cents != null && !hasRecurring(account.id, category);
        return { month, amountCents: any ? sum : estimate ? Number(contract.expected_monthly_cents) : null, units: null, free: false, partial: false, phaseStarts: false, estimate };
      });
      const peak = Math.max(1, ...cells.map((c) => c.amountCents ?? 0));
      return {
        key: contract.id, account, category, cells, peak, first: index === 0, live: contract.status === "active",
        total: cells.reduce((sum, c) => sum + (c.amountCents ?? 0), 0),
        note: category === "valet" && account.property.unit_count ? `${account.property.unit_count} units` : "",
        recurringId: null as string | null,
        // A per-job service with nothing logged and no usual month has nothing to show.
        empty: eventBased && cells.every((c) => c.amountCents === null),
      };
    });
    // Recurring invoices: the same amount on the same day every month.
    type Recurring = { id: string; account_id: string; name: string; service_category: string; day_of_month: number; start_month: string; lines: { quantity: string; unit_price_cents: number }[] };
    const repeating = ((recurringRes.data ?? []) as Recurring[]).filter((r) => r.account_id === account.id).map((r) => {
      const amount = r.lines.reduce((sum, l) => sum + (lineAmountCents(String(l.quantity), Number(l.unit_price_cents)) ?? 0), 0);
      const cells: Cell[] = months.map((month) => ({ month, amountCents: month >= r.start_month ? amount : null, units: null, free: false, partial: false, phaseStarts: false, estimate: false }));
      return {
        key: r.id, account, category: (isServiceCategory(r.service_category) ? r.service_category : "other") as ServiceCategory, cells, peak: Math.max(1, amount),
        first: false, live: contracts.some((c) => c.status === "active"), total: cells.reduce((sum, c) => sum + (c.amountCents ?? 0), 0),
        note: `${r.name}, day ${r.day_of_month}`, recurringId: r.id as string | null, empty: false,
      };
    });
    const all = [...perContract, ...repeating].filter((row) => !row.empty);
    if (all.length > 0 && !all.some((row) => row.first)) all[0].first = true;
    return all;
  });
  const shown = rows.filter((r) => view === "all" || r.category === view);
  const columnTotals = months.map((_, i) => shown.reduce((sum, r) => sum + (r.cells[i].amountCents ?? 0), 0));
  const yearTotal = columnTotals.reduce((a, b) => a + b, 0);
  const anyOff = list.some((a) => a.contracts.some((c) => c.status === "draft"));
  const link = (service: string, y = year) => `/schedule?year=${y}${service === "all" ? "" : `&service=${service}`}`;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Planning"
        title="Schedule of billing"
        description="What every property is contracted to be billed each month, by service. A draft invoice is created for each month shown here once billing is switched on."
        action={<Link href="/accounts/new?next=schedule" className={primaryButton}>Launch a property</Link>}
      />
      {query.saved && <Notice kind="ok">{query.saved}</Notice>}
      {query.error && <Notice kind="error">{query.error}</Notice>}
      {accounts.error && <Notice kind="error">Could not load the schedule: {accounts.error.message}</Notice>}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Link href={link(view, year - 1)} className={secondaryButton} aria-label="Previous year">&larr;</Link>
          <span className="font-display min-w-20 text-center text-2xl font-extrabold tabular-nums text-ink">{year}</span>
          <Link href={link(view, year + 1)} className={secondaryButton} aria-label="Next year">&rarr;</Link>
          <div className="ml-2 flex flex-wrap gap-1 rounded-full border border-line bg-white p-1">
            {(["all", ...SERVICE_ORDER.filter((c) => c !== "other" || rows.some((r) => r.category === "other"))] as const).map((key) => {
              const active = view === key;
              return (
                <Link
                  key={key}
                  href={link(key)}
                  aria-current={active ? "page" : undefined}
                  className={`flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-medium transition ${active ? "bg-ink text-white" : "text-slate-600 hover:bg-slate-100"}`}
                >
                  {key !== "all" && <span className="size-2.5 rounded-full" style={{ backgroundColor: SERVICES[key].hex }} aria-hidden />}
                  {key === "all" ? "All services" : SERVICES[key].label}
                </Link>
              );
            })}
          </div>
        </div>
        {anyOff && (
          <form action={turnOnAllBilling}>
            <SubmitButton className={secondaryButton}>Turn billing on for all</SubmitButton>
          </form>
        )}
      </div>

      <ul className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-mute">
        <li className="flex items-center gap-1.5"><span className="size-3 rounded bg-ice ring-1 ring-sky-200" /> Free month</li>
        <li className="flex items-center gap-1.5"><span className="size-3 rounded border border-dashed border-slate-400" /> Partial month</li>
        <li className="flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-ink" /> Rate or unit change</li>
        <li className="flex items-center gap-1.5"><span className="font-semibold text-emerald-600">&#10003;</span> Invoiced</li>
        <li className="flex items-center gap-1.5"><span className="italic">est.</span> Usual month for work billed per load</li>
        <li>Recurring invoices show their name and day of the month</li>
      </ul>

      {shown.length === 0 ? (
        <Empty>{rows.length === 0 ? "No properties yet. Click Launch a property to add the first one." : "No property has this service yet."}</Empty>
      ) : (
        <div className="overflow-x-auto rounded-3xl border border-line bg-white shadow-[0_1px_2px_rgb(16_24_40/0.04)]">
          <div className="min-w-[1200px]">
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

            {shown.map(({ key, account, category, cells, peak, total, live, first, note, recurringId }, index) => {
              const newClient = index === 0 || shown[index - 1].account.customer.id !== account.customer.id;
              const service = SERVICES[category];
              const showSwitch = first || view !== "all";
              return (
                <div key={key}>
                  {newClient && (
                    <div className="border-b border-line bg-ink px-5 py-2 font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-white/70">
                      <span className="sticky left-5">{account.customer.name}</span>
                    </div>
                  )}
                  <div className={`${GRID} group border-b border-line`}>
                    <div className="sticky left-0 z-10 flex items-center justify-between gap-2 bg-white py-3 pl-0 pr-2 transition group-hover:bg-slate-50">
                      <Link href={`/schedule/${account.id}`} className="flex min-w-0 items-center gap-3">
                        <span className="h-10 w-1.5 shrink-0 rounded-r-full" style={{ backgroundColor: service.hex }} aria-hidden />
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-ink">{account.property.name}</span>
                          <span className="block truncate text-xs" style={{ color: service.hex }}>
                            <span className="font-semibold">{service.label}</span>
                            {note ? <span className="text-mute"> · {note}</span> : null}
                          </span>
                        </span>
                      </Link>
                      {showSwitch && (
                        <form action={toggleBilling}>
                          <input type="hidden" name="account_id" value={account.id} />
                          <input type="hidden" name="turn" value={live ? "off" : "on"} />
                          <input type="hidden" name="return_to" value={link(view)} />
                          <button
                            title={live ? "Billing is on. Click to turn it off." : "Billing is off. Click to turn it on."}
                            aria-label={`Billing for ${account.property.name} is ${live ? "on" : "off"}. Click to switch.`}
                            className={`flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition ${live ? "justify-end bg-emerald-500" : "justify-start bg-slate-300"}`}
                          >
                            <span className="size-5 rounded-full bg-white shadow" />
                          </button>
                        </form>
                      )}
                    </div>
                    {cells.map((cell) => {
                      const invoice = recurringId ? recurringInvoiced.get(`${recurringId}:${cell.month}`) : invoiced.get(`${account.id}:${category}:${cell.month}`);
                      const billable = live && account.go_live_service_month !== null && cell.month >= account.go_live_service_month;
                      const strength = cell.amountCents ? 0.08 + 0.22 * (cell.amountCents / peak) : 0;
                      return (
                        <div key={cell.month} className={`p-1 ${cell.month === thisMonth ? "bg-slate-50" : ""}`}>
                          {cell.amountCents === null ? (
                            <div className="flex h-12 items-center justify-end px-2 text-slate-300">&middot;</div>
                          ) : (
                            <div
                              className={`relative flex h-12 flex-col items-end justify-center rounded-lg px-2 ${cell.free ? "bg-ice" : ""} ${cell.partial ? "border border-dashed border-slate-400" : ""}`}
                              style={cell.free ? undefined : { backgroundColor: `rgb(${service.rgb} / ${(cell.estimate ? strength / 2 : strength).toFixed(3)})` }}
                              title={`${account.property.name}, ${service.label}, ${MONTHS[Number(cell.month.slice(5, 7)) - 1]} ${year}: ${formatCents(cell.amountCents)}${cell.estimate ? " (estimate)" : ""}${invoice ? `, invoiced ${formatCents(Number(invoice.total_cents))}` : ""}`}
                            >
                              {cell.phaseStarts && <span className="absolute left-1.5 top-1.5 size-1.5 rounded-full bg-ink" aria-hidden />}
                              <span className={`text-[13px] font-semibold tabular-nums ${billable || invoice ? "text-ink" : "text-slate-500"} ${cell.estimate ? "italic" : ""}`}>
                                {invoice && <span className="mr-1 text-emerald-600">&#10003;</span>}
                                {cell.free ? "Free" : compact(invoice ? Number(invoice.total_cents) : cell.amountCents)}
                              </span>
                              {cell.units !== null && !cell.free && <span className="text-[10px] leading-tight text-mute">{cell.units} units</span>}
                              {cell.estimate && <span className="text-[10px] italic leading-tight text-mute">est.</span>}
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
              <div className="sticky left-0 z-10 bg-ink px-5 py-4 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-white/60">
                {view === "all" ? "Scheduled total" : `${SERVICES[view].short} total`}
              </div>
              {columnTotals.map((t, i) => (
                <div key={i} className="px-2 py-4 text-right text-[13px] font-semibold tabular-nums">{t ? compact(t) : ""}</div>
              ))}
              <div className="font-display px-4 py-4 text-right text-[15px] font-extrabold tabular-nums">{compact(yearTotal)}</div>
            </div>
          </div>
        </div>
      )}
      <p className="text-xs text-mute">
        Grey amounts will not be invoiced by this app: the property is switched off, or the month is before its first month here. Free months get no invoice. Click a property to see its contract and schedule.
      </p>
    </div>
  );
}
