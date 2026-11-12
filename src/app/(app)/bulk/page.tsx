import Link from "next/link";
import { SubmitButton } from "@/components/submit-button";
import { Empty, inputClass, Notice, PageHeader, primaryButton, secondaryButton, Stat } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { firstWeekdayOfMonth, monthEnd, monthLabel, parts, todayInPhoenix, iso } from "@/lib/billing/dates";
import { formatDate } from "@/lib/format";
import { centsToInput, formatCents, lineAmountCents } from "@/lib/money";
import { SERVICES } from "@/lib/services";
import { InvoiceTabs } from "@/components/section-tabs";
import { removePickup, saveBulkRun } from "./actions";

type Contract = { status: string; service_category: string | null; expected_monthly_cents: number | null; event_rates: { event_type: string; rate_cents: number }[] };
type Account = { id: string; go_live_service_month: string | null; property: { name: string }; customer: { name: string }; contracts: Contract[] };
type Pickup = { id: string; account_id: string; event_date: string; quantity: number; rate_cents: number | null; status: string };

export default async function BulkPage({ searchParams }: { searchParams: Promise<{ month?: string; saved?: string; error?: string }> }) {
  const { supabase } = await requireAdmin();
  const query = await searchParams;
  const today = todayInPhoenix();
  const month = /^\d{4}-\d{2}$/.test(query.month ?? "") ? query.month! : today.slice(0, 7);
  const first = `${month}-01`;
  const { y, m } = parts(first);
  const shift = (by: number) => {
    const d = new Date(Date.UTC(y, m - 1 + by, 1));
    return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, 1).slice(0, 7);
  };

  const [accountsRes, pickupsRes] = await Promise.all([
    supabase
      .from("billing_accounts")
      .select("id, go_live_service_month, property:properties(name), customer:customers(name), contracts(status, service_category, expected_monthly_cents, event_rates:contract_event_rates(event_type, rate_cents))")
      .eq("status", "active"),
    supabase.from("billable_events").select("id, account_id, event_date, quantity, rate_cents, status").eq("event_type", "bulk_pickup").gte("event_date", first).lte("event_date", monthEnd(first)).order("event_date"),
  ]);
  const pickups = (pickupsRes.data ?? []) as Pickup[];
  const onInvoice = pickups.length
    ? await supabase.from("invoice_lines").select("billable_event_id, invoice:invoices!invoice_lines_invoice_id_fkey(id, status, invoice_number)").in("billable_event_id", pickups.map((p) => p.id))
    : { data: [] };
  const invoiceOf = new Map(
    (onInvoice.data ?? [])
      .map((l) => [l.billable_event_id as string, l.invoice as unknown as { id: string; status: string; invoice_number: number | null } | null] as const)
      .filter(([, inv]) => inv && inv.status !== "void"),
  );

  // Every property with a bulk trash service, and its normal price and usual loads.
  const rows = ((accountsRes.data ?? []) as unknown as Account[])
    .map((a) => {
      const bulk = a.contracts.find((c) => c.service_category === "bulk" && c.status !== "ended");
      const rate = bulk?.event_rates.find((r) => r.event_type === "bulk_pickup");
      if (!bulk || !rate) return null;
      const price = Number(rate.rate_cents);
      const usual = bulk.expected_monthly_cents != null && price > 0 ? Math.round((100 * Number(bulk.expected_monthly_cents)) / price) / 100 : 1;
      return {
        account: a, price, usual, on: a.contracts.some((c) => c.status === "active"),
        tooEarly: !a.go_live_service_month || first < a.go_live_service_month,
        done: pickups.filter((p) => p.account_id === a.id),
      };
    })
    .filter((r) => r !== null)
    .sort((a, b) => a.account.customer.name.localeCompare(b.account.customer.name) || a.account.property.name.localeCompare(b.account.property.name));

  const todo = rows.filter((r) => r.done.length === 0);
  const amount = (p: Pickup, price: number) => lineAmountCents(String(Number(p.quantity)), p.rate_cents ?? price) ?? 0;
  const logged = rows.reduce((sum, r) => sum + r.done.reduce((s, p) => s + amount(p, r.price), 0), 0);
  const expected = todo.reduce((sum, r) => sum + (lineAmountCents(String(r.usual), r.price) ?? 0), 0);
  const defaultDate = firstWeekdayOfMonth(first, 1);
  const bulk = SERVICES.bulk;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Bulk pickups"
        title="Invoices"
        description="Every bulk property, prefilled with its usual loads and price. Enter what the field reported, then save. Each pickup becomes a draft dated the day we were there."
      />
      <InvoiceTabs supabase={supabase} current="none" />
      {query.saved && <Notice kind="ok">{query.saved}</Notice>}
      {query.error && <Notice kind="error">{query.error}</Notice>}

      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/bulk?month=${shift(-1)}`} className={secondaryButton} aria-label="Previous month">&larr;</Link>
        <span className="font-display min-w-52 text-center text-2xl font-extrabold text-ink">{monthLabel(first)}</span>
        <Link href={`/bulk?month=${shift(1)}`} className={secondaryButton} aria-label="Next month">&rarr;</Link>
        <Link href="/review?service=bulk" className={`${secondaryButton} ml-auto`}>
          <span className="size-2.5 rounded-full" style={{ backgroundColor: bulk.hex }} aria-hidden /> Bulk review queue
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat dark label="Expected this month" value={formatCents(logged + expected)} detail={`${rows.length} bulk propert${rows.length === 1 ? "y" : "ies"}`} />
        <Stat label="Pickups saved" value={formatCents(logged)} detail={`${rows.length - todo.length} of ${rows.length} properties`} />
        <Stat label="Still to enter" value={formatCents(expected)} detail={`${todo.length} at usual loads`} />
      </div>

      {rows.length === 0 && <Empty>No property has bulk trash yet. Add it from a property page, under Bulk trash.</Empty>}

      {todo.length > 0 && (
        <form action={saveBulkRun} className="overflow-hidden rounded-3xl border border-line bg-white shadow-[0_1px_2px_rgb(16_24_40/0.04)]">
          <input type="hidden" name="month" value={month} />
          <div className="hidden grid-cols-[minmax(0,1.6fr)_11rem_7rem_9rem_8rem] gap-3 border-b border-line bg-slate-50/80 px-6 py-3 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-mute md:grid">
            <span>Property</span><span>Day we were there</span><span className="text-right">Loads</span><span className="text-right">Price per load</span><span className="text-right">Normal</span>
          </div>
          <ul className="divide-y divide-line">
            {todo.map((r) => (
              <li key={r.account.id} className="grid items-center gap-3 px-4 py-3 sm:px-6 md:grid-cols-[minmax(0,1.6fr)_11rem_7rem_9rem_8rem]">
                <input type="hidden" name="account_id" value={r.account.id} />
                <input type="hidden" name="property_name" value={r.account.property.name} />
                <div className="flex min-w-0 items-center gap-3">
                  <span className="h-9 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: bulk.hex }} aria-hidden />
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-ink">{r.account.property.name}</span>
                    <span className="block truncate text-xs text-mute">
                      {r.account.customer.name}
                      {!r.on && <span className="text-amber-700"> · billing is off, so it will be saved but not drafted</span>}
                      {r.on && r.tooEarly && <span className="text-amber-700"> · before this property&apos;s first month here</span>}
                    </span>
                  </span>
                </div>
                <input type="date" name="date" defaultValue={defaultDate} min={first} max={monthEnd(first)} aria-label={`Pickup date for ${r.account.property.name}`} className={inputClass} />
                <input name="loads" inputMode="decimal" defaultValue={r.usual} aria-label={`Loads for ${r.account.property.name}`} className={`${inputClass} text-right tabular-nums`} />
                <input name="price" inputMode="decimal" defaultValue={centsToInput(r.price)} aria-label={`Price per load for ${r.account.property.name}`} className={`${inputClass} text-right tabular-nums`} />
                <span className="hidden text-right text-sm tabular-nums text-mute md:block">{r.usual} at {formatCents(r.price)}</span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-slate-50/60 px-4 py-4 sm:px-6">
            <p className="text-sm text-mute">Clear the loads for any property that had no pickup this month.</p>
            <SubmitButton className={primaryButton}>Save pickups and draft invoices</SubmitButton>
          </div>
        </form>
      )}

      {rows.some((r) => r.done.length > 0) && (
        <section>
          <h2 className="mb-2 font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-mute">Saved for {monthLabel(first)}</h2>
          <ul className="divide-y divide-line overflow-hidden rounded-3xl border border-line bg-white shadow-[0_1px_2px_rgb(16_24_40/0.04)]">
            {rows.flatMap((r) =>
              r.done.map((p) => {
                const invoice = invoiceOf.get(p.id);
                const differs = Number(p.quantity) !== r.usual || (p.rate_cents != null && Number(p.rate_cents) !== r.price);
                return (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-ink">{r.account.property.name}</p>
                      <p className="text-sm text-mute">
                        {formatDate(p.event_date)} · {Number(p.quantity)} load{Number(p.quantity) === 1 ? "" : "s"} at {formatCents(p.rate_cents ?? r.price)}
                        {differs && <span className="text-amber-700"> · differs from the usual {r.usual} at {formatCents(r.price)}</span>}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-[17px] font-semibold tabular-nums text-ink">{formatCents(amount(p, r.price))}</span>
                      {invoice ? (
                        <Link href={invoice.status === "draft" ? "/review?service=bulk" : `/invoices/${invoice.id}`} className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ${invoice.status === "draft" ? "bg-amber-50 text-amber-800 ring-amber-200" : "bg-emerald-50 text-emerald-700 ring-emerald-200"}`}>
                          {invoice.status === "draft" ? "Draft in review" : `Invoice ${invoice.invoice_number}`}
                        </Link>
                      ) : (
                        <span className="rounded-full bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600 ring-1 ring-slate-200">Not drafted</span>
                      )}
                      {(!invoice || invoice.status === "draft") && (
                        <form action={removePickup}>
                          <input type="hidden" name="month" value={month} />
                          <input type="hidden" name="event_id" value={p.id} />
                          <SubmitButton className="text-sm font-medium text-red-600 underline-offset-4 hover:underline">Remove</SubmitButton>
                        </form>
                      )}
                    </div>
                  </li>
                );
              }),
            )}
          </ul>
        </section>
      )}
    </div>
  );
}
