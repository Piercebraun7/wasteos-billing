import type { SupabaseClient } from "@supabase/supabase-js";
import { categoryOfModel, SERVICES, type ServiceCategory } from "../services";
import { addDays, monthEnd, monthLabel, monthStart, type ISODate } from "./dates";
import {
  applyTax,
  eventLines,
  invoiceDates,
  mayInvoice,
  rateFor,
  recurringLines,
  type BillableEvent,
  type BillingModel,
  type EventRate,
  type Phase,
} from "./invoice-math";

type ContractRow = {
  id: string;
  status: string;
  billing_model: BillingModel;
  service_category: ServiceCategory | null;
  quoted_basis: "pre_tax" | "tax_inclusive" | null;
  net_days: number;
  tax_enabled: boolean;
  tax_rate_bps: number;
  start_date: ISODate | null;
  created_at: string;
  phases: Phase[];
  event_rates: EventRate[];
};
type AccountRow = {
  id: string;
  go_live_service_month: ISODate | null;
  property: { name: string };
  contracts: ContractRow[];
};

export type DraftRun = { created: string[]; skipped: { property: string; reason: string }[] };

const isEventBased = (model: string) => model === "per_event" || model === "as_needed";

/** The service that bills a piece of logged work: a per-job service with a rate first, then any service with a rate. */
function ownerOf(event: BillableEvent, contracts: ContractRow[]): ContractRow | undefined {
  return (
    contracts.find((c) => isEventBased(c.billing_model) && rateFor(event, c.event_rates) !== null) ??
    contracts.find((c) => rateFor(event, c.event_rates) !== null)
  );
}

/**
 * Drafts the scheduled invoices for a service month: one per property, per
 * service that is switched on. Nothing is posted or sent: drafts wait in the
 * review queue. A month with nothing owed (a free month) gets no invoice.
 */
export async function generateDrafts(supabase: SupabaseClient, serviceMonth: ISODate): Promise<DraftRun> {
  const first = monthStart(serviceMonth);
  const last = monthEnd(serviceMonth);
  const run: DraftRun = { created: [], skipped: [] };

  const [accounts, existing, events] = await Promise.all([
    supabase
      .from("billing_accounts")
      .select("id, go_live_service_month, property:properties(name), contracts(*, phases:contract_phases(*), event_rates:contract_event_rates(*))")
      .eq("status", "active"),
    supabase.from("invoices").select("account_id, service_category").eq("service_month", first).eq("origin", "app").eq("kind", "scheduled").neq("status", "void"),
    supabase.from("billable_events").select("*").eq("status", "approved").gte("event_date", first).lte("event_date", last),
  ]);
  if (accounts.error) throw new Error(accounts.error.message);
  if (existing.error) throw new Error(existing.error.message);
  if (events.error) throw new Error(events.error.message);

  // Per-job work (bulk pickups and the like) first: one draft per property per day of work.
  const loggedWork = await draftLoggedWork(supabase);
  run.created.push(...loggedWork.created);
  run.skipped.push(...loggedWork.skipped);
  const loggedWorkHandled = new Set(loggedWork.skippedAccounts);

  const alreadyInvoiced = new Set((existing.data ?? []).map((r) => `${r.account_id}:${r.service_category ?? ""}`));
  const rows = (accounts.data ?? []) as unknown as AccountRow[];

  for (const account of rows.sort((a, b) => a.property.name.localeCompare(b.property.name))) {
    const active = account.contracts.filter((c) => c.status === "active").sort((a, b) => a.created_at.localeCompare(b.created_at));
    if (active.length === 0) continue; // Billing is off: not an exception, just not billed.

    const accountEvents = ((events.data ?? []) as (BillableEvent & { account_id: string })[])
      .filter((e) => e.account_id === account.id)
      .map((e) => ({ ...e, quantity: Number(e.quantity) }));
    // Each piece of logged work is billed by the first service that has a rate for it.
    const owner = new Map<string, string>();
    for (const event of accountEvents) {
      const match = ownerOf(event, active);
      if (match) owner.set(event.id, match.id);
    }
    const unowned = accountEvents.filter((e) => !owner.has(e.id));

    for (const contract of active) {
      // Services billed per job are invoiced by draftLoggedWork, dated the day of the job.
      if (isEventBased(contract.billing_model)) continue;
      const category = contract.service_category ?? categoryOfModel(contract.billing_model);
      const label = `${account.property.name} (${SERVICES[category].short})`;
      const skip = (reason: string) => run.skipped.push({ property: label, reason });

      if (!account.go_live_service_month) {
        skip("No first service month is set.");
        continue;
      }
      if (!mayInvoice(first, account.go_live_service_month)) {
        skip(`Its first month here is ${monthLabel(account.go_live_service_month)}. Earlier months belong to QuickBooks.`);
        continue;
      }
      if (alreadyInvoiced.has(`${account.id}:${category}`)) continue;

      // Contracts keep billing past their term until billing is switched off, so no end date is applied.
      const recurring = recurringLines({ model: contract.billing_model, phases: contract.phases, serviceMonth: first, contractStart: contract.start_date });
      const mine = accountEvents.filter((e) => owner.get(e.id) === contract.id);
      const perEvent = eventLines({ events: mine, rates: contract.event_rates, serviceMonth: first });
      const charges = [...recurring, ...perEvent.lines];
      const owed = charges.reduce((sum, l) => sum + l.amount_cents, 0);
      if (charges.length === 0 || owed === 0) continue; // Nothing owed this month (for example a free month).

      const totals = applyTax(charges, { enabled: contract.tax_enabled, rateBps: contract.tax_rate_bps, basis: contract.quoted_basis });
      const dates = invoiceDates(first, contract.net_days);
      const { data, error } = await supabase.rpc("create_draft_invoice", {
        p: {
          account_id: account.id,
          service_month: first,
          ...dates,
          subtotal_cents: totals.subtotal_cents,
          tax_cents: totals.tax_cents,
          total_cents: totals.total_cents,
          kind: "scheduled",
          service_category: category,
          lines: totals.lines,
        },
      });
      if (error) skip(error.message);
      else run.created.push(data as string);
    }

    if (unowned.length > 0 && !loggedWorkHandled.has(account.id)) {
      run.skipped.push({
        property: account.property.name,
        reason: `${unowned.length} piece${unowned.length === 1 ? "" : "s"} of logged work ${unowned.length === 1 ? "has" : "have"} no rate, so ${unowned.length === 1 ? "it was" : "they were"} not billed.`,
      });
    }
  }
  return run;
}

/**
 * Drafts invoices for logged work that is billed per job (bulk pickups and
 * similar). Each day of work on a property becomes one draft, dated that day.
 * Work already on an invoice is never drafted twice.
 */
export async function draftLoggedWork(supabase: SupabaseClient, accountId?: string): Promise<DraftRun & { skippedAccounts: string[] }> {
  const run: DraftRun & { skippedAccounts: string[] } = { created: [], skipped: [], skippedAccounts: [] };
  let accountQuery = supabase
    .from("billing_accounts")
    .select("id, go_live_service_month, property:properties(name), contracts(*, phases:contract_phases(*), event_rates:contract_event_rates(*))")
    .eq("status", "active");
  if (accountId) accountQuery = accountQuery.eq("id", accountId);
  let eventQuery = supabase.from("billable_events").select("*").eq("status", "approved");
  if (accountId) eventQuery = eventQuery.eq("account_id", accountId);
  const [accounts, events] = await Promise.all([accountQuery, eventQuery]);
  if (accounts.error) throw new Error(accounts.error.message);
  if (events.error) throw new Error(events.error.message);
  const all = ((events.data ?? []) as (BillableEvent & { account_id: string })[]).map((e) => ({ ...e, quantity: Number(e.quantity) }));
  if (all.length === 0) return run;

  // Anything already on a live invoice (draft or posted) is left alone.
  const onInvoice = await supabase
    .from("invoice_lines")
    .select("billable_event_id, invoice:invoices!invoice_lines_invoice_id_fkey(status)")
    .in("billable_event_id", all.map((e) => e.id));
  if (onInvoice.error) throw new Error(onInvoice.error.message);
  const billed = new Set(
    (onInvoice.data ?? [])
      .filter((l) => (l.invoice as unknown as { status: string } | null)?.status !== "void")
      .map((l) => l.billable_event_id as string),
  );

  for (const account of (accounts.data ?? []) as unknown as AccountRow[]) {
    const active = account.contracts.filter((c) => c.status === "active").sort((a, b) => a.created_at.localeCompare(b.created_at));
    const pending = all.filter((e) => e.account_id === account.id && !billed.has(e.id));
    if (pending.length === 0) continue;
    if (active.length === 0) {
      run.skipped.push({ property: account.property.name, reason: "Billing is switched off for this property." });
      run.skippedAccounts.push(account.id);
      continue;
    }
    const groups = new Map<string, { contract: ContractRow; date: ISODate; events: BillableEvent[] }>();
    let noRate = 0;
    for (const event of pending) {
      const contract = ownerOf(event, active);
      if (!contract) {
        noRate++;
        continue;
      }
      if (!isEventBased(contract.billing_model)) continue; // Goes on that service's monthly invoice.
      if (!mayInvoice(event.event_date, account.go_live_service_month)) {
        run.skipped.push({
          property: account.property.name,
          reason: account.go_live_service_month
            ? `Work on ${event.event_date} is before ${monthLabel(account.go_live_service_month)}, this property's first month here.`
            : "No first service month is set.",
        });
        run.skippedAccounts.push(account.id);
        continue;
      }
      const key = `${contract.id}:${event.event_date}`;
      const group = groups.get(key) ?? { contract, date: event.event_date, events: [] };
      group.events.push(event);
      groups.set(key, group);
    }
    if (noRate > 0) {
      run.skipped.push({ property: account.property.name, reason: `${noRate} piece${noRate === 1 ? "" : "s"} of logged work ${noRate === 1 ? "has" : "have"} no rate, so ${noRate === 1 ? "it was" : "they were"} not billed.` });
      run.skippedAccounts.push(account.id);
    }

    for (const { contract, date, events: list } of groups.values()) {
      const { lines } = eventLines({ events: list, rates: contract.event_rates, serviceMonth: date });
      const totals = applyTax(lines, { enabled: contract.tax_enabled, rateBps: contract.tax_rate_bps, basis: contract.quoted_basis });
      const { data, error } = await supabase.rpc("create_draft_invoice", {
        p: {
          account_id: account.id,
          service_month: monthStart(date),
          invoice_date: date,
          due_date: addDays(date, contract.net_days),
          subtotal_cents: totals.subtotal_cents,
          tax_cents: totals.tax_cents,
          total_cents: totals.total_cents,
          kind: "ad_hoc",
          service_category: contract.service_category ?? categoryOfModel(contract.billing_model),
          lines: totals.lines,
        },
      });
      if (error) run.skipped.push({ property: account.property.name, reason: error.message });
      else run.created.push(data as string);
    }
  }
  return run;
}
