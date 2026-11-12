import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, dangerButton, Eyebrow, Field, Needed, inputClass, Notice, primaryButton, secondaryButton } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { requireAdmin } from "@/lib/auth";
import { monthLabel } from "@/lib/billing/dates";
import { BILLING_MODELS, EVENT_TYPES, formatDate, usesPhases } from "@/lib/format";
import { bpsToInput, centsToInput, formatCents, lineAmountCents } from "@/lib/money";
import {
  removeRecurring,
  setRecurringStatus,
  updateBulkRate,
  removeProperty,
  addBillableEvent,
  addBulkService,
  toggleBilling,
  addEventRate,
  removeBillableEvent,
  updateBillingSetup,
  removeContact,
  removeEventRate,
  removePhase,
  saveContact,
  savePhase,
  updateBillTo,
  updateContract,
  updateProperty,
} from "../actions";

type Phase = {
  id: string;
  label: string;
  effective_start: string;
  billable_units: number | null;
  rate_per_unit_cents: number | null;
  flat_amount_cents: number | null;
  superseded_at: string | null;
};
type EventRate = { id: string; event_type: string; time_window: string | null; rate_cents: number };
type Contract = {
  id: string;
  status: string;
  billing_model: string;
  quoted_basis: string | null;
  net_days: number;
  start_date: string | null;
  end_date: string | null;
  preferred_agreement: boolean;
  rebate_bps: number;
  notion_url: string | null;
  created_at: string;
  late_fee_template_id: string | null;
  escalation_bps: number | null;
  rate_notice_days: number | null;
  service_category: string | null;
  expected_monthly_cents: number | null;
  late_fee_template: { name: string; confirmed_at: string | null } | null;
  phases: Phase[];
  event_rates: EventRate[];
};
type Account = {
  id: string;
  status: string;
  go_live_service_month: string | null;
  property: {
    id: string;
    name: string;
    address_line1: string | null;
    address_line2: string | null;
    city: string | null;
    state: string | null;
    postal_code: string | null;
    unit_count: number | null;
  };
  customer: { id: string; name: string; is_ach_payer: boolean };
  owner: { id: string; legal_name: string } | null;
  contacts: { id: string; name: string; email: string; role: string | null; created_at: string }[];
  contracts: Contract[];
};

function phaseAmount(model: string, p: Phase): string {
  if (model === "per_unit_valet" && p.billable_units !== null && p.rate_per_unit_cents !== null) {
    return `${p.billable_units} units at ${formatCents(p.rate_per_unit_cents)} = ${formatCents(p.billable_units * p.rate_per_unit_cents)} per month`;
  }
  return p.flat_amount_cents !== null ? `${formatCents(p.flat_amount_cents)} per month` : "";
}

const TABS = [
  ["overview", "Overview"],
  ["schedule", "Schedule"],
  ["contacts", "Contacts"],
  ["more", "More"],
] as const;

export default async function AccountPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; error?: string; tab?: string }>;
}) {
  const { supabase } = await requireAdmin();
  const { id } = await params;
  const { saved, error: errorMessage, tab: wantedTab } = await searchParams;
  const tab = TABS.some(([key]) => key === wantedTab) ? wantedTab! : "overview";
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const [recurringRes, templates, invoicesRes, eventsRes, { data, error }, overview] = await Promise.all([
    supabase.from("recurring_invoices").select("*").eq("account_id", id).order("created_at"),
    supabase.from("late_fee_templates").select("id, name").not("confirmed_at", "is", null).order("name"),
    supabase.from("invoices").select("id, invoice_number, service_month, due_date, status, total_cents").eq("account_id", id).order("service_month", { ascending: false }),
    supabase.from("billable_events").select("id, event_date, event_type, time_window, quantity, description, status").eq("account_id", id).order("event_date", { ascending: false }).limit(25),
    supabase
      .from("billing_accounts")
      .select(
        `id, status, go_live_service_month,
         property:properties(*),
         customer:customers(id, name, is_ach_payer),
         owner:owner_entities(id, legal_name),
         contacts:billing_contacts(id, name, email, role, created_at),
         contracts(*, late_fee_template:late_fee_templates(name, confirmed_at),
           phases:contract_phases(*), event_rates:contract_event_rates(*))`,
      )
      .eq("id", id)
      .maybeSingle(),
    supabase.from("account_overview").select("balance_cents").eq("account_id", id).maybeSingle(),
  ]);
  const recurring = (recurringRes.data ?? []) as {
    id: string; name: string; service_category: string; day_of_month: number; status: string;
    lines: { description: string; quantity: string; unit_price_cents: number }[];
  }[];
  if (error) return <Notice kind="error">Could not load this account: {error.message}</Notice>;
  if (!data) notFound();

  const account = data as unknown as Account;
  const { property, customer, owner } = account;
  const contacts = [...account.contacts].sort((a, b) =>
    a.created_at.localeCompare(b.created_at),
  );
  const byAge = [...account.contracts].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const contract = byAge.find((c) => usesPhases(c.billing_model)) ?? byAge[0];
  const bulk = byAge.find((c) => c.service_category === "bulk");
  const bulkRate = bulk?.event_rates.find((r) => r.event_type === "bulk_pickup");
  const phases = contract ? [...contract.phases].sort((a, b) => a.effective_start.localeCompare(b.effective_start)) : [];
  const balance = Number(overview.data?.balance_cents ?? 0);
  const hidden = (
    <>
      <input type="hidden" name="account_id" value={account.id} />
      <input type="hidden" name="tab" value={tab} />
    </>
  );
  const address = [property.address_line1, property.city, property.state].filter(Boolean).join(", ");
  const current = [...phases].reverse().find((p) => !p.superseded_at);
  const facts: [string, string][] = [
    ["Units", property.unit_count !== null ? String(property.unit_count) : "Not set"],
    ["Billing model", contract ? BILLING_MODELS[contract.billing_model] ?? contract.billing_model : "No contract"],
    ["Latest rate", contract && current ? phaseAmount(contract.billing_model, current).split(" = ").pop()! : "Not set"],
    ["Service start", contract?.start_date ? formatDate(contract.start_date) : "Not set"],
  ];

  const billingOn = contract?.status === "active";
  // What only a person can supply. Everything else is filled in when billing is turned on.
  const need = {
    contact: contacts.length === 0,
    phase: Boolean(contract && usesPhases(contract.billing_model) && phases.filter((p) => !p.superseded_at).length === 0),
  };
  const anythingNeeded = Object.values(need).some(Boolean);

  return (
    <div className="space-y-5">
      <div>
        <Link href="/accounts" className="inline-flex items-center gap-1.5 text-sm font-medium text-mute transition hover:text-ink">
          <span aria-hidden>&larr;</span> Properties
        </Link>
        <div className="relative mt-4 overflow-hidden rounded-[28px] bg-ink p-6 text-white sm:p-9">
          <div className="grid-lines pointer-events-none absolute inset-0" aria-hidden />
          <div
            className="pointer-events-none absolute -right-24 -top-24 size-80 rounded-full opacity-20 blur-3xl"
            style={{ background: "radial-gradient(closest-side, #ff4b37, transparent)" }}
            aria-hidden
          />
          <div className="relative flex flex-wrap items-end justify-between gap-8">
            <div className="min-w-0">
              <Eyebrow className="!text-white/50">Account</Eyebrow>
              <h1 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">{property.name}</h1>
              <p className="mt-2 text-[15px] text-white/60">
                Billed to {customer.name}
                {address && ` · ${address}`}
              </p>
            </div>
            <div className="sm:text-right">
              <Eyebrow className="!text-white/50">Account balance</Eyebrow>
              <p className="font-display mt-2 text-5xl font-extrabold tracking-tight tabular-nums sm:text-6xl">{formatCents(balance)}</p>
            </div>
          </div>
          <dl className="relative mt-8 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-white/10 pt-6 sm:grid-cols-4">
            {facts.map(([label, value]) => (
              <div key={label}>
                <dt className="font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-white/40">{label}</dt>
                <dd className="mt-1 truncate text-[15px] font-medium text-white">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>

      {saved && <Notice kind="ok">{saved}</Notice>}
      {errorMessage && <Notice kind="error">{errorMessage}</Notice>}
      {anythingNeeded && (
        <p className="text-sm text-mute">
          <Needed /> Still needed for this property.
        </p>
      )}

      <div className="flex flex-wrap gap-1 rounded-full border border-line bg-white p-1 sm:w-fit">
        {TABS.map(([key, label]) => (
          <Link key={key} href={`/accounts/${account.id}${key === "overview" ? "" : `?tab=${key}`}`} aria-current={tab === key ? "page" : undefined}
            className={`rounded-full px-4 py-2 text-sm font-medium transition ${tab === key ? "bg-ink text-white" : "text-slate-600 hover:bg-slate-100"}`}>
            {label}
            {key === "contacts" && need.contact && <Needed />}
            {key === "schedule" && need.phase && <Needed />}
          </Link>
        ))}
      </div>

      {tab === "overview" && (
        <>
      {contract && (
        <section className="rounded-3xl border border-line bg-white p-5 shadow-[0_1px_2px_rgb(16_24_40/0.04)] sm:p-7">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="flex items-center gap-2.5 text-lg font-semibold tracking-tight text-ink">
                <span className={`size-2.5 rounded-full ${billingOn ? "bg-emerald-500" : "bg-slate-300"}`} aria-hidden />
                Billing is {billingOn ? "on" : "off"}
              </p>
              <p className="mt-1 text-sm text-mute">
                Net {contract.net_days} · {contract.late_fee_template?.name ?? "3% monthly"} late fee · quoted {contract.quoted_basis === "tax_inclusive" ? "tax-inclusive" : "pre-tax"} ·{" "}
                {account.go_live_service_month ? `first invoice from this app: ${monthLabel(account.go_live_service_month)} service` : "first invoice from this app: this month's service"}
              </p>
            </div>
            <form action={toggleBilling}>
              {hidden}
              <input type="hidden" name="turn" value={billingOn ? "off" : "on"} />
              <SubmitButton className={billingOn ? secondaryButton : primaryButton}>{billingOn ? "Turn billing off" : "Turn billing on"}</SubmitButton>
            </form>
          </div>
          <details className="mt-4 border-t border-line pt-4">
            <summary className="cursor-pointer text-sm font-medium text-ink">Change these terms</summary>
            <form action={updateBillingSetup} className="mt-4 grid gap-4 sm:grid-cols-3">
              {hidden}
              <input type="hidden" name="contract_id" value={contract.id} />
              {billingOn && <input type="hidden" name="active" value="on" />}
              <Field label="Late fee terms">
                <select name="late_fee_template_id" defaultValue={contract.late_fee_template_id ?? ""} className={inputClass}>
                  {(templates.data ?? []).length === 0 && <option value="">None confirmed yet</option>}
                  {(templates.data ?? []).map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="First service month this app invoices" hint="Earlier months stay in QuickBooks, which prevents double billing.">
                <input type="month" name="go_live_month" defaultValue={account.go_live_service_month?.slice(0, 7) ?? ""} className={inputClass} />
              </Field>
              <div className="self-end pb-0.5">
                <SubmitButton className={secondaryButton}>Save terms</SubmitButton>
              </div>
            </form>
          </details>
        </section>
      )}

      <Card title="Invoices" description="Scheduled and one-off invoices for this property.">
        <Link href={`/invoices/new?account=${account.id}`} className={`${secondaryButton} mb-3`}>Create invoice</Link>
        {(invoicesRes.data ?? []).length === 0 ? (
          <p className="text-sm text-mute">No invoices yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {(invoicesRes.data ?? []).map((inv) => (
              <li key={inv.id}>
                <Link href={`/invoices/${inv.id}`} className="flex items-center justify-between gap-4 py-3 transition hover:opacity-70">
                  <span>
                    <span className="font-medium text-ink">{inv.invoice_number ? `Invoice ${inv.invoice_number}` : "Draft"}</span>
                    <span className="text-mute"> · {monthLabel(inv.service_month)} · {inv.status.replace("_", " ")} · due {formatDate(inv.due_date)}</span>
                  </span>
                  <span className="font-semibold tabular-nums text-ink">{formatCents(Number(inv.total_cents))}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

        </>
      )}

      {tab === "contacts" && (
        <>
      <Card title="Points of contact" description="The people at this property who receive its invoices by email." needed={need.contact}>
        <div className="space-y-3">
          {contacts.length === 0 && <p className="text-sm text-mute">No contacts yet. Invoices cannot be sent until there is at least one.</p>}
          {contacts.map((c) => (
            <div key={c.id} className="flex flex-wrap items-end gap-2">
              <form action={saveContact} className="grid flex-1 gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
                {hidden}
                <input type="hidden" name="contact_id" value={c.id} />
                <input name="name" defaultValue={c.name} aria-label="Contact name" className={inputClass} />
                <input name="email" type="email" defaultValue={c.email} aria-label="Contact email" className={inputClass} />
                <input name="role" defaultValue={c.role ?? ""} placeholder="Role" aria-label="Contact role" className={inputClass} />
                <SubmitButton className={secondaryButton}>Save</SubmitButton>
              </form>
              <form action={removeContact}>
                {hidden}
                <input type="hidden" name="contact_id" value={c.id} />
                <SubmitButton className={dangerButton}>Remove</SubmitButton>
              </form>
            </div>
          ))}
          <form action={saveContact} className="grid gap-2 border-t border-line pt-4 sm:grid-cols-[1fr_1fr_1fr_auto]">
            {hidden}
            <input name="name" placeholder="Name" aria-label="New contact name" className={inputClass} />
            <input name="email" type="email" placeholder="Email" aria-label="New contact email" className={inputClass} />
            <input name="role" placeholder="Role" aria-label="New contact role" className={inputClass} />
            <SubmitButton className={primaryButton}>Add contact</SubmitButton>
          </form>
        </div>
      </Card>

        </>
      )}

      {tab === "more" && (
        <>
      <Card title="Property">
        <form action={updateProperty} className="grid gap-4 sm:grid-cols-6">
          {hidden}
          <input type="hidden" name="property_id" value={property.id} />
          <Field label="Property name" className="sm:col-span-4">
            <input name="name" required defaultValue={property.name} className={inputClass} />
          </Field>
          <Field label="Unit count" className="sm:col-span-2">
            <input name="unit_count" inputMode="numeric" defaultValue={property.unit_count ?? ""} className={inputClass} />
          </Field>
          <Field label="Street address" className="sm:col-span-4">
            <input name="address_line1" defaultValue={property.address_line1 ?? ""} className={inputClass} />
          </Field>
          <Field label="Suite or building" className="sm:col-span-2">
            <input name="address_line2" defaultValue={property.address_line2 ?? ""} className={inputClass} />
          </Field>
          <Field label="City" className="sm:col-span-3">
            <input name="city" defaultValue={property.city ?? ""} className={inputClass} />
          </Field>
          <Field label="State" className="sm:col-span-1">
            <input name="state" maxLength={2} defaultValue={property.state ?? ""} className={inputClass} />
          </Field>
          <Field label="ZIP" className="sm:col-span-2">
            <input name="postal_code" defaultValue={property.postal_code ?? ""} className={inputClass} />
          </Field>
          <div className="sm:col-span-6">
            <SubmitButton className={primaryButton}>Save property</SubmitButton>
          </div>
        </form>
      </Card>

      <Card title="Client" description="The property manager this property is billed to. Renaming the client changes it on every one of its properties.">
        <form action={updateBillTo} className="grid gap-4 sm:grid-cols-2">
          {hidden}
          <input type="hidden" name="customer_id" value={customer.id} />
          <input type="hidden" name="owner_entity_id" value={owner?.id ?? ""} />
          <Field label="Client name">
            <input name="customer_name" required defaultValue={customer.name} className={inputClass} />
          </Field>
          <Field label="Legal owner (optional)" hint="Clear the box to remove the owner from this account.">
            <input name="owner_legal_name" defaultValue={owner?.legal_name ?? ""} className={inputClass} />
          </Field>
          <label className="flex items-center gap-2 text-sm text-slate-600 sm:col-span-2">
            <input name="is_ach_payer" type="checkbox" defaultChecked={customer.is_ach_payer} className="size-4" />
            This client pays by ACH (bank transfer instructions will print on its invoices)
          </label>
          <div className="sm:col-span-2">
            <SubmitButton className={primaryButton}>Save client details</SubmitButton>
          </div>
        </form>
      </Card>

        </>
      )}

      {contract && (
        <>
          {tab === "more" && (
          <Card title="Contract terms">
            <form action={updateContract} className="grid gap-4 sm:grid-cols-3">
              {hidden}
              <input type="hidden" name="contract_id" value={contract.id} />
              <Field label="Billing model">
                <select name="billing_model" defaultValue={contract.billing_model} className={inputClass}>
                  {Object.entries(BILLING_MODELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Net days" hint="Days from invoice date to due date.">
                <input name="net_days" inputMode="numeric" defaultValue={contract.net_days} className={inputClass} />
              </Field>
              <Field label="Quoted amount is" hint="From the signed contract.">
                <select name="quoted_basis" defaultValue={contract.quoted_basis ?? ""} className={inputClass}>
                  <option value="">Not confirmed yet</option>
                  <option value="pre_tax">Pre-tax</option>
                  <option value="tax_inclusive">Tax-inclusive</option>
                </select>
              </Field>
              <Field label="Service start date">
                <input name="start_date" type="date" defaultValue={contract.start_date ?? ""} className={inputClass} />
              </Field>
              <Field label="Contract end date (optional)">
                <input name="end_date" type="date" defaultValue={contract.end_date ?? ""} className={inputClass} />
              </Field>
              <Field label="Rebate percent" hint="0 if none.">
                <input name="rebate_percent" inputMode="decimal" defaultValue={bpsToInput(contract.rebate_bps)} className={inputClass} />
              </Field>
              <Field label="Annual increase percent" hint="Applied from month 13, once confirmed under Rate increases.">
                <input name="escalation_percent" inputMode="decimal" defaultValue={bpsToInput(contract.escalation_bps ?? 300)} className={inputClass} />
              </Field>
              <Field label="Notice days for a rate change" hint="From the signed contract.">
                <input name="rate_notice_days" inputMode="numeric" defaultValue={contract.rate_notice_days ?? 90} className={inputClass} />
              </Field>
              <label className="flex items-center gap-2 text-sm text-slate-600 sm:col-span-3">
                <input name="preferred_agreement" type="checkbox" defaultChecked={contract.preferred_agreement} className="size-4" />
                Under the RPM Living national preferred agreement
              </label>
              <Field label="Link to the signed contract in Notion (optional)" className="sm:col-span-3">
                <input name="notion_url" type="url" defaultValue={contract.notion_url ?? ""} className={inputClass} />
              </Field>
              <p className="text-sm text-mute sm:col-span-3">
                Sales tax: off.
              </p>
              <div className="sm:col-span-3">
                <SubmitButton className={primaryButton}>Save contract terms</SubmitButton>
              </div>
            </form>
          </Card>
          )}

          {usesPhases(contract.billing_model) && tab === "schedule" && (
            <Card
              title="Phases"
              needed={need.phase}
              description="Each phase takes effect on its start date and stays in effect until the next one starts. Once a phase has been invoiced it is locked: add a new phase with a later start date instead."
            >
              <div className="space-y-4">
                {phases.length === 0 && <p className="text-sm text-mute">No phases yet. Add the first one below.</p>}
                {phases.map((p) => (
                  <div key={p.id}>
                    <div className="flex flex-wrap items-end gap-2">
                      <form action={savePhase} className="grid flex-1 gap-2 sm:grid-cols-[1.2fr_1fr_0.8fr_0.8fr_auto]">
                        {hidden}
                        <input type="hidden" name="phase_id" value={p.id} />
                        <input type="hidden" name="billing_model" value={contract.billing_model} />
                        <input name="label" defaultValue={p.label} aria-label="Phase label" className={inputClass} />
                        <input name="effective_start" type="date" defaultValue={p.effective_start} aria-label="Phase start date" className={inputClass} />
                        {contract.billing_model === "per_unit_valet" ? (
                          <>
                            <input name="units" inputMode="numeric" defaultValue={p.billable_units ?? ""} placeholder="Billable units" aria-label="Billable units" className={inputClass} />
                            <input name="rate" inputMode="decimal" defaultValue={centsToInput(p.rate_per_unit_cents)} placeholder="$ per unit" aria-label="Rate per unit in dollars" className={inputClass} />
                          </>
                        ) : (
                          <input name="flat" inputMode="decimal" defaultValue={centsToInput(p.flat_amount_cents)} placeholder="$ per month" aria-label="Monthly amount in dollars" className={`${inputClass} sm:col-span-2`} />
                        )}
                        <SubmitButton className={secondaryButton}>Save</SubmitButton>
                      </form>
                      <form action={removePhase}>
                        {hidden}
                        <input type="hidden" name="phase_id" value={p.id} />
                        <SubmitButton className={dangerButton}>Remove</SubmitButton>
                      </form>
                    </div>
                    <p className="mt-1 text-sm text-mute">
                      From {formatDate(p.effective_start)}: {phaseAmount(contract.billing_model, p)}
                      {p.superseded_at && " (superseded)"}
                    </p>
                  </div>
                ))}
                <form action={savePhase} className="grid gap-2 border-t border-line pt-4 sm:grid-cols-[1.2fr_1fr_0.8fr_0.8fr_auto]">
                  {hidden}
                  <input type="hidden" name="contract_id" value={contract.id} />
                  <input type="hidden" name="billing_model" value={contract.billing_model} />
                  <input name="label" placeholder="Label, for example Phase 2" aria-label="New phase label" className={inputClass} />
                  <input name="effective_start" type="date" aria-label="New phase start date" className={inputClass} />
                  {contract.billing_model === "per_unit_valet" ? (
                    <>
                      <input name="units" inputMode="numeric" placeholder="Billable units" aria-label="Billable units" className={inputClass} />
                      <input name="rate" inputMode="decimal" placeholder="$ per unit" aria-label="Rate per unit in dollars" className={inputClass} />
                    </>
                  ) : (
                    <input name="flat" inputMode="decimal" placeholder="$ per month" aria-label="Monthly amount in dollars" className={`${inputClass} sm:col-span-2`} />
                  )}
                  <SubmitButton className={primaryButton}>Add phase</SubmitButton>
                </form>
              </div>
            </Card>
          )}

          {tab === "more" && (
          <Card
            title="Rates for one-off work"
            description="Dumpster moves, bulk pickups, trash room visits, and as-needed jobs. Work with no rate here is held for review and never billed at a guessed rate."
          >
            <div className="space-y-3">
              {contract.event_rates.length === 0 && <p className="text-sm text-mute">No rates yet.</p>}
              {contract.event_rates.map((r) => (
                <form key={r.id} action={removeEventRate} className="flex items-center justify-between gap-3">
                  {hidden}
                  <input type="hidden" name="rate_id" value={r.id} />
                  <p className="text-slate-900">
                    {EVENT_TYPES[r.event_type] ?? r.event_type}
                    {r.time_window && ` (${r.time_window})`}: <span className="font-semibold">{formatCents(r.rate_cents)}</span> each
                  </p>
                  <SubmitButton className={dangerButton}>Remove</SubmitButton>
                </form>
              ))}
              <form action={addEventRate} className="grid gap-2 border-t border-line pt-4 sm:grid-cols-[1fr_1fr_0.8fr_auto]">
                {hidden}
                <input type="hidden" name="contract_id" value={contract.id} />
                <select name="event_type" aria-label="Type of work" className={inputClass}>
                  {Object.entries(EVENT_TYPES).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
                <input name="time_window" placeholder="Visit window (optional)" aria-label="Visit window" className={inputClass} />
                <input name="rate" inputMode="decimal" placeholder="$ each" aria-label="Rate in dollars" className={inputClass} />
                <SubmitButton className={primaryButton}>Add rate</SubmitButton>
              </form>
            </div>
          </Card>
          )}

          {tab === "overview" && (
          <Card
            title="Bulk trash"
            description="Billed on its own invoice, separate from the monthly service. Set the normal price once and every bulk invoice for this property starts from it."
          >
            {bulkRate && bulk ? (
              <form action={updateBulkRate} className="flex flex-wrap items-end gap-2">
                {hidden}
                <input type="hidden" name="rate_id" value={bulkRate.id} />
                <input type="hidden" name="contract_id" value={bulk.id} />
                <Field label="Normal price per load">
                  <input name="rate" inputMode="decimal" defaultValue={centsToInput(bulkRate.rate_cents)} className={`${inputClass} w-40 text-right tabular-nums`} />
                </Field>
                <Field label="Usual loads per month">
                  <input
                    name="loads"
                    inputMode="decimal"
                    defaultValue={bulk.expected_monthly_cents != null && bulkRate.rate_cents > 0 ? Math.round((100 * Number(bulk.expected_monthly_cents)) / bulkRate.rate_cents) / 100 : 1}
                    className={`${inputClass} w-32 text-right tabular-nums`}
                  />
                </Field>
                <SubmitButton className={secondaryButton}>Save</SubmitButton>
                <Link href="/bulk" className={`${secondaryButton} ml-auto`}>Open this month&apos;s bulk run</Link>
              </form>
            ) : (
              <form action={addBulkService} className="flex flex-wrap items-end gap-2">
                {hidden}
                <Field label="Normal price per load">
                  <input name="rate" inputMode="decimal" defaultValue="350.00" className={`${inputClass} w-40 text-right tabular-nums`} />
                </Field>
                <Field label="Usual loads per month">
                  <input name="loads" inputMode="decimal" defaultValue="1" className={`${inputClass} w-32 text-right tabular-nums`} />
                </Field>
                <SubmitButton className={primaryButton}>Add bulk trash</SubmitButton>
              </form>
            )}
          </Card>
          )}

          {tab === "schedule" && (
          <Card title="Recurring invoices" description="Each one drafts an invoice every month on its day, for you to review and approve. They appear on the schedule of billing.">
            {recurring.length === 0 ? (
              <p className="text-sm text-mute">
                None yet. Tick Repeat on <Link href={`/invoices/new?account=${account.id}`} className="font-medium text-ink underline">Create invoice</Link> to add one.
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {recurring.map((r) => {
                  const total = r.lines.reduce((sum, l) => sum + (lineAmountCents(String(l.quantity), Number(l.unit_price_cents)) ?? 0), 0);
                  return (
                    <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                      <div>
                        <p className="font-medium text-ink">
                          {r.name} <span className="font-normal text-mute">· {formatCents(total)} on day {r.day_of_month} of each month</span>
                        </p>
                        <p className="text-sm text-mute">
                          {r.lines.map((l) => `${l.description}, ${l.quantity} at ${formatCents(Number(l.unit_price_cents))}`).join("; ")}
                          {r.status === "paused" && " · paused"}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <form action={setRecurringStatus}>
                          {hidden}
                          <input type="hidden" name="recurring_id" value={r.id} />
                          <input type="hidden" name="to" value={r.status === "paused" ? "active" : "paused"} />
                          <SubmitButton className={secondaryButton}>{r.status === "paused" ? "Resume" : "Pause"}</SubmitButton>
                        </form>
                        <form action={removeRecurring}>
                          {hidden}
                          <input type="hidden" name="recurring_id" value={r.id} />
                          <SubmitButton className={dangerButton}>Remove</SubmitButton>
                        </form>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
          )}

          {tab === "more" && (
          <Card
            title="Logged work"
            description="Dumpster moves, bulk pickups, and other one-off jobs. Each is billed on the invoice for the month it was done, at the rate above."
          >
            <div className="space-y-3">
              {(eventsRes.data ?? []).length === 0 && <p className="text-sm text-mute">Nothing logged yet.</p>}
              {(eventsRes.data ?? []).map((e) => (
                <form key={e.id} action={removeBillableEvent} className="flex items-center justify-between gap-3">
                  {hidden}
                  <input type="hidden" name="event_id" value={e.id} />
                  <p className="text-slate-900">
                    {formatDate(e.event_date)}: {EVENT_TYPES[e.event_type] ?? e.event_type}
                    {e.time_window && ` (${e.time_window})`}
                    {Number(e.quantity) !== 1 && `, quantity ${Number(e.quantity)}`}
                    {e.description && `, ${e.description}`}
                    <span className="text-mute"> · {e.status === "invoiced" ? "invoiced" : "not yet invoiced"}</span>
                  </p>
                  {e.status !== "invoiced" && <SubmitButton className={dangerButton}>Remove</SubmitButton>}
                </form>
              ))}
              <form action={addBillableEvent} className="grid gap-2 border-t border-line pt-4 sm:grid-cols-[1fr_1.1fr_0.6fr_1.3fr_auto]">
                {hidden}
                <input name="event_date" type="date" aria-label="Date of work" className={inputClass} />
                <select name="event_type" aria-label="Type of work" className={inputClass}>
                  {Object.entries(EVENT_TYPES).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
                <input name="quantity" inputMode="decimal" defaultValue="1" aria-label="Quantity" className={inputClass} />
                <input name="description" placeholder="Note (optional)" aria-label="Note" className={inputClass} />
                <SubmitButton className={primaryButton}>Log work</SubmitButton>
              </form>
            </div>
          </Card>
          )}
        </>
      )}

      {tab === "more" && (
        <>
      <details className="rounded-3xl border border-line bg-white p-5 sm:p-7">
        <summary className="cursor-pointer text-sm font-medium text-red-600">Remove this property</summary>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-mute">
          If this property has never been invoiced, it is deleted along with its drafts, schedule, and contacts. If it has any billing history, it is archived instead: billing stops, and its invoices and balance are kept.
        </p>
        <form action={removeProperty} className="mt-4">
          {hidden}
          <input type="hidden" name="property_name" value={property.name} />
          <SubmitButton className={`${dangerButton} border border-red-200`}>Yes, remove {property.name}</SubmitButton>
        </form>
      </details>
        </>
      )}

    </div>
  );
}
