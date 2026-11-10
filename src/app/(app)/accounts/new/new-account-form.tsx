"use client";

import { useState, useTransition } from "react";
import { Card, Field, inputClass, Notice, primaryButton, secondaryButton } from "@/components/ui";
import { BILLING_MODELS, usesPhases } from "@/lib/format";
import { createAccount } from "../actions";

let nextKey = 1;
const newKey = () => nextKey++;

export function NewAccountForm({
  customers,
  owners,
  defaultNetDays,
  next,
}: {
  customers: { id: string; name: string }[];
  owners: { id: string; legal_name: string }[];
  defaultNetDays: number;
  next: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [customerId, setCustomerId] = useState("");
  const [ownerChoice, setOwnerChoice] = useState("");
  const [model, setModel] = useState("per_unit_valet");
  const [contacts, setContacts] = useState<number[]>(() => [newKey()]);
  const [phases, setPhases] = useState<number[]>(() => [newKey()]);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setError(null);
    startTransition(async () => {
      const result = await createAccount(formData);
      if (result?.error) {
        setError(result.error);
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="mt-8 space-y-5">
      {error && <Notice kind="error">{error}</Notice>}
      <input type="hidden" name="next" value={next} />

      <Card title="Client" description="The property manager. One client can have many properties.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Client" needed>
            <select name="customer_id" value={customerId} onChange={(e) => setCustomerId(e.target.value)} className={inputClass}>
              <option value="">New client</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </Field>
          {!customerId && (
            <Field label="New client name" needed>
              <input name="customer_name" className={inputClass} />
            </Field>
          )}
          <Field label="Legal owner (optional)" hint="Only when the owner is different from the client.">
            <select name="owner_entity_id" value={ownerChoice} onChange={(e) => setOwnerChoice(e.target.value)} className={inputClass}>
              <option value="">None</option>
              <option value="new">New owner</option>
              {owners.map((o) => (
                <option key={o.id} value={o.id}>{o.legal_name}</option>
              ))}
            </select>
          </Field>
          {ownerChoice === "new" && (
            <Field label="New owner legal name">
              <input name="owner_legal_name" className={inputClass} />
            </Field>
          )}
        </div>
      </Card>

      <Card title="Property" description="The property is billed on its own invoice, under the client above.">
        <div className="grid gap-4 sm:grid-cols-6">
          <Field label="Property name" className="sm:col-span-4" needed>
            <input name="property_name" required className={inputClass} />
          </Field>
          <Field label="Unit count" className="sm:col-span-2">
            <input name="unit_count" inputMode="numeric" className={inputClass} />
          </Field>
          <Field label="Street address" className="sm:col-span-4">
            <input name="address_line1" className={inputClass} />
          </Field>
          <Field label="Suite or building" className="sm:col-span-2">
            <input name="address_line2" className={inputClass} />
          </Field>
          <Field label="City" className="sm:col-span-3">
            <input name="city" className={inputClass} />
          </Field>
          <Field label="State" className="sm:col-span-1">
            <input name="state" defaultValue="AZ" maxLength={2} className={inputClass} />
          </Field>
          <Field label="ZIP" className="sm:col-span-2">
            <input name="postal_code" inputMode="numeric" className={inputClass} />
          </Field>
        </div>
      </Card>

      <Card title="Points of contact" description="The people at this property who receive its invoices by email.">
        <div className="space-y-3">
          {contacts.map((key) => (
            <div key={key} className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
              <input name="contact_name" placeholder="Name" aria-label="Contact name" className={inputClass} />
              <input name="contact_email" type="email" placeholder="Email" aria-label="Contact email" className={inputClass} />
              <input name="contact_role" placeholder="Role, for example Accounts payable" aria-label="Contact role" className={inputClass} />
              <button type="button" className={secondaryButton} onClick={() => setContacts(contacts.filter((k) => k !== key))}>
                Remove
              </button>
            </div>
          ))}
        </div>
        <button type="button" className={`${secondaryButton} mt-3`} onClick={() => setContacts([...contacts, newKey()])}>
          Add contact
        </button>
      </Card>

      <Card title="Contract">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Billing model" needed>
            <select name="billing_model" value={model} onChange={(e) => setModel(e.target.value)} className={inputClass}>
              {Object.entries(BILLING_MODELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </Field>
          <Field label="Net days" hint="Days from invoice date to due date.">
            <input name="net_days" inputMode="numeric" defaultValue={defaultNetDays} className={inputClass} />
          </Field>
          <Field label="Quoted amount is" hint="From the signed contract. Leave as not confirmed if unsure.">
            <select name="quoted_basis" className={inputClass}>
              <option value="">Not confirmed yet</option>
              <option value="pre_tax">Pre-tax</option>
              <option value="tax_inclusive">Tax-inclusive</option>
            </select>
          </Field>
          <Field label="Service start date">
            <input name="start_date" type="date" className={inputClass} />
          </Field>
          <Field label="Contract end date (optional)">
            <input name="end_date" type="date" className={inputClass} />
          </Field>
          <Field label="Rebate percent" hint="Paid back yearly under a preferred agreement. 0 if none.">
            <input name="rebate_percent" inputMode="decimal" defaultValue="0" className={inputClass} />
          </Field>
          <label className="flex items-center gap-2 text-sm text-slate-600 sm:col-span-3">
            <input name="preferred_agreement" type="checkbox" className="size-4" />
            Under the RPM Living national preferred agreement
          </label>
          <Field label="Link to the signed contract in Notion (optional)" className="sm:col-span-3">
            <input name="notion_url" type="url" placeholder="https://www.notion.so/..." className={inputClass} />
          </Field>
        </div>
      </Card>

      {usesPhases(model) ? (
        <Card
          title="Phases"
          description="One row per step of the ramp, each starting on its own date. A contract with a single rate needs one row. Use 0 for a free month."
        >
          <div className="space-y-3">
            {phases.map((key) => (
              <div key={key} className="grid gap-2 sm:grid-cols-[1.2fr_1fr_0.8fr_0.8fr_auto]">
                <input name="phase_label" placeholder="Label, for example Full rate" aria-label="Phase label" className={inputClass} />
                <input name="phase_start" type="date" aria-label="Phase start date" className={inputClass} />
                {model === "per_unit_valet" ? (
                  <>
                    <input name="phase_units" inputMode="numeric" placeholder="Billable units" aria-label="Billable units" className={inputClass} />
                    <input name="phase_rate" inputMode="decimal" placeholder="$ per unit" aria-label="Rate per unit in dollars" className={inputClass} />
                    <input type="hidden" name="phase_flat" value="" />
                  </>
                ) : (
                  <>
                    <input type="hidden" name="phase_units" value="" />
                    <input type="hidden" name="phase_rate" value="" />
                    <input name="phase_flat" inputMode="decimal" placeholder="$ per month" aria-label="Monthly amount in dollars" className={`${inputClass} sm:col-span-2`} />
                  </>
                )}
                <button type="button" className={secondaryButton} onClick={() => setPhases(phases.filter((k) => k !== key))}>
                  Remove
                </button>
              </div>
            ))}
          </div>
          <button type="button" className={`${secondaryButton} mt-3`} onClick={() => setPhases([...phases, newKey()])}>
            Add phase
          </button>
        </Card>
      ) : (
        <Notice kind="info">
          This billing model has no monthly charge. After saving, add the rate for each type of work on the account page.
        </Notice>
      )}

      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className={primaryButton}>
          {pending ? "Saving..." : "Create account"}
        </button>
        {error && <span className="text-sm text-red-700">Not saved yet. See the message at the top.</span>}
      </div>
    </form>
  );
}
