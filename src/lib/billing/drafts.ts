import type { SupabaseClient } from "@supabase/supabase-js";
import { monthEnd, monthLabel, monthStart, type ISODate } from "./dates";
import {
  applyTax,
  eventLines,
  invoiceDates,
  mayInvoice,
  recurringLines,
  type BillableEvent,
  type BillingModel,
  type EventRate,
  type Phase,
} from "./invoice-math";

type AccountRow = {
  id: string;
  go_live_service_month: ISODate | null;
  property: { name: string };
  contracts: {
    id: string;
    status: string;
    billing_model: BillingModel;
    quoted_basis: "pre_tax" | "tax_inclusive" | null;
    net_days: number;
    tax_enabled: boolean;
    tax_rate_bps: number;
    start_date: ISODate | null;
    end_date: ISODate | null;
    phases: Phase[];
    event_rates: EventRate[];
  }[];
};

export type DraftRun = { created: string[]; skipped: { property: string; reason: string }[] };

/**
 * Drafts one invoice per active billing account for the service month.
 * Nothing is posted or sent: drafts wait in the review queue.
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
    supabase.from("invoices").select("account_id").eq("service_month", first).eq("origin", "app").neq("status", "void"),
    supabase.from("billable_events").select("*").eq("status", "approved").gte("event_date", first).lte("event_date", last),
  ]);
  if (accounts.error) throw new Error(accounts.error.message);
  if (existing.error) throw new Error(existing.error.message);
  if (events.error) throw new Error(events.error.message);

  const alreadyInvoiced = new Set((existing.data ?? []).map((r) => r.account_id as string));
  const rows = (accounts.data ?? []) as unknown as AccountRow[];

  for (const account of rows.sort((a, b) => a.property.name.localeCompare(b.property.name))) {
    const skip = (reason: string) => run.skipped.push({ property: account.property.name, reason });
    const contract = account.contracts.find((c) => c.status === "active");
    if (!contract) {
      skip("The contract is not active for billing yet.");
      continue;
    }
    if (!account.go_live_service_month) {
      skip("No go-live service month is set.");
      continue;
    }
    if (!mayInvoice(first, account.go_live_service_month)) {
      skip(`Goes live with ${monthLabel(account.go_live_service_month)} service. Earlier months belong to QuickBooks.`);
      continue;
    }
    if (alreadyInvoiced.has(account.id)) {
      skip(`Already has an invoice for ${monthLabel(first)}.`);
      continue;
    }

    const recurring = recurringLines({
      model: contract.billing_model,
      phases: contract.phases,
      serviceMonth: first,
      contractStart: contract.start_date,
      contractEnd: contract.end_date,
    });
    const accountEvents = ((events.data ?? []) as (BillableEvent & { account_id: string })[])
      .filter((e) => e.account_id === account.id)
      .map((e) => ({ ...e, quantity: Number(e.quantity) }));
    const perEvent = eventLines({ events: accountEvents, rates: contract.event_rates, serviceMonth: first });
    const charges = [...recurring, ...perEvent.lines];
    if (charges.length === 0) {
      skip(perEvent.held.length ? "Work was logged, but the contract has no rate for it." : `Nothing to bill for ${monthLabel(first)}.`);
      continue;
    }

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
        lines: totals.lines,
      },
    });
    if (error) skip(error.message);
    else run.created.push(data as string);
  }
  return run;
}
