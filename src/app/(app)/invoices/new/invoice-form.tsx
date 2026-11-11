"use client";

import { useMemo, useState, useTransition } from "react";
import { Card, Field, inputClass, Notice, primaryButton, secondaryButton } from "@/components/ui";
import { addDays } from "@/lib/billing/dates";
import { formatDate } from "@/lib/format";
import { centsToInput, formatCents, lineAmountCents, parseSignedDollarsToCents } from "@/lib/money";
import { SERVICE_ORDER, SERVICES, type ServiceCategory } from "@/lib/services";
import { createInvoice } from "../actions";

type Account = { account_id: string; property_name: string; customer_name: string; balance_cents: number };
type Item = { id: string; name: string; category: string; description: string | null; default_rate_cents: number | null };
type Line = { key: number; item: string; description: string; quantity: string; rate: string };

let nextKey = 1;
const blank = (): Line => ({ key: nextKey++, item: "", description: "", quantity: "1", rate: "" });
const TERMS = [
  { days: 0, label: "Due on receipt" },
  { days: 15, label: "Net 15" },
  { days: 30, label: "Net 30" },
  { days: 45, label: "Net 45" },
  { days: 60, label: "Net 60" },
];

export function InvoiceForm({
  accounts,
  items,
  today,
  defaultNetDays,
  preselected,
}: {
  accounts: Account[];
  items: Item[];
  today: string;
  defaultNetDays: number;
  preselected: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [accountId, setAccountId] = useState(accounts.some((a) => a.account_id === preselected) ? preselected : "");
  const [search, setSearch] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(today);
  const [netDays, setNetDays] = useState(defaultNetDays);
  const [lines, setLines] = useState<Line[]>(() => [blank()]);

  const selected = accounts.find((a) => a.account_id === accountId);
  const matches = useMemo(() => {
    const words = search.toLowerCase().split(/\s+/).filter(Boolean);
    return accounts.filter((a) => words.every((w) => `${a.property_name} ${a.customer_name}`.toLowerCase().includes(w))).slice(0, 8);
  }, [accounts, search]);

  const amounts = lines.map((l) => {
    const rate = parseSignedDollarsToCents(l.rate);
    return rate === null ? null : lineAmountCents(l.quantity || "1", rate);
  });
  const total = amounts.reduce<number>((sum, a) => sum + (a ?? 0), 0);
  const dueDate = /^\d{4}-\d{2}-\d{2}$/.test(invoiceDate) ? addDays(invoiceDate, netDays) : "";

  const update = (key: number, patch: Partial<Line>) => setLines((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  function chooseItem(key: number, itemId: string) {
    const item = items.find((i) => i.id === itemId);
    update(key, {
      item: itemId,
      ...(item ? { description: item.description || item.name, rate: item.default_rate_cents != null ? (item.default_rate_cents < 0 ? "-" : "") + centsToInput(Math.abs(item.default_rate_cents)) : "" } : {}),
    });
  }

  function submit(intent: "draft" | "approve", form: HTMLFormElement) {
    const formData = new FormData(form);
    formData.set("intent", intent);
    setError(null);
    startTransition(async () => {
      const result = await createInvoice(formData);
      if (result?.error) {
        setError(result.error);
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit("draft", e.currentTarget);
      }}
      className="mt-8 space-y-5"
    >
      {error && <Notice kind="error">{error}</Notice>}
      <input type="hidden" name="account_id" value={accountId} />
      <input type="hidden" name="net_days" value={netDays} />

      <Card title="Customer">
        {selected ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-slate-50/70 px-4 py-3">
            <div>
              <p className="font-semibold text-ink">{selected.property_name}</p>
              <p className="text-sm text-mute">
                {selected.customer_name} · current balance {formatCents(Number(selected.balance_cents))}
              </p>
            </div>
            <button type="button" className={secondaryButton} onClick={() => setAccountId("")}>Change</button>
          </div>
        ) : accountId === "new" ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Customer or property name" needed>
              <input name="new_customer_name" autoFocus className={inputClass} />
            </Field>
            <Field label="Client (property manager), if different">
              <input name="new_client_name" className={inputClass} />
            </Field>
            <Field label="Contact name">
              <input name="new_customer_contact" className={inputClass} />
            </Field>
            <Field label="Email for invoices">
              <input name="new_customer_email" type="email" className={inputClass} />
            </Field>
            <div className="sm:col-span-2">
              <button type="button" className={secondaryButton} onClick={() => setAccountId("")}>Choose an existing customer instead</button>
            </div>
          </div>
        ) : (
          <div>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Start typing a property or client name"
              aria-label="Find a customer"
              autoFocus
              className={inputClass}
            />
            <ul className="mt-2 divide-y divide-line overflow-hidden rounded-2xl border border-line">
              {matches.map((a) => (
                <li key={a.account_id}>
                  <button type="button" onClick={() => setAccountId(a.account_id)} className="flex w-full items-center justify-between gap-4 px-4 py-2.5 text-left transition hover:bg-slate-50">
                    <span>
                      <span className="font-medium text-ink">{a.property_name}</span>
                      <span className="text-mute"> · {a.customer_name}</span>
                    </span>
                    <span className="text-sm tabular-nums text-mute">{formatCents(Number(a.balance_cents))}</span>
                  </button>
                </li>
              ))}
              <li>
                <button type="button" onClick={() => setAccountId("new")} className="w-full px-4 py-2.5 text-left font-medium text-ink transition hover:bg-slate-50">
                  + Add a new customer
                </button>
              </li>
            </ul>
          </div>
        )}
      </Card>

      <Card title="Invoice details">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Invoice date">
            <input type="date" name="invoice_date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Terms">
            <select value={netDays} onChange={(e) => setNetDays(Number(e.target.value))} className={inputClass} aria-label="Payment terms">
              {[...TERMS, ...(TERMS.some((t) => t.days === defaultNetDays) ? [] : [{ days: defaultNetDays, label: `Net ${defaultNetDays}` }])].map((t) => (
                <option key={t.days} value={t.days}>{t.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Due date">
            <p className="flex h-11 items-center rounded-xl border border-line bg-slate-50 px-3.5 text-[15px] text-ink">{dueDate ? formatDate(dueDate) : ""}</p>
          </Field>
        </div>
      </Card>

      <Card title="Products and services">
        <div className="hidden grid-cols-[1.3fr_1.6fr_5rem_7rem_7rem_auto] gap-2 pb-2 font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-mute md:grid">
          <span>Product or service</span><span>Description</span><span className="text-right">Qty</span><span className="text-right">Rate</span><span className="text-right">Amount</span><span className="w-[4.6rem]" />
        </div>
        <div className="space-y-2">
          {lines.map((l, i) => (
            <div key={l.key} className="grid gap-2 md:grid-cols-[1.3fr_1.6fr_5rem_7rem_7rem_auto]">
              <select name="line_item" value={l.item} onChange={(e) => chooseItem(l.key, e.target.value)} aria-label={`Line ${i + 1} product or service`} className={inputClass}>
                <option value="">Choose, or type a description</option>
                {SERVICE_ORDER.map((category) => {
                  const group = items.filter((it) => it.category === category);
                  return group.length ? (
                    <optgroup key={category} label={SERVICES[category as ServiceCategory].label}>
                      {group.map((it) => (
                        <option key={it.id} value={it.id}>{it.name}</option>
                      ))}
                    </optgroup>
                  ) : null;
                })}
              </select>
              <input name="line_description" value={l.description} onChange={(e) => update(l.key, { description: e.target.value })} placeholder="What was done" aria-label={`Line ${i + 1} description`} className={inputClass} />
              <input name="line_quantity" value={l.quantity} onChange={(e) => update(l.key, { quantity: e.target.value })} inputMode="decimal" aria-label={`Line ${i + 1} quantity`} className={`${inputClass} text-right tabular-nums`} />
              <input name="line_rate" value={l.rate} onChange={(e) => update(l.key, { rate: e.target.value })} inputMode="decimal" placeholder="0.00" aria-label={`Line ${i + 1} rate in dollars`} className={`${inputClass} text-right tabular-nums`} />
              <p className="flex h-11 items-center justify-end px-1 text-[15px] font-semibold tabular-nums text-ink">{amounts[i] === null ? "" : formatCents(amounts[i]!)}</p>
              <button type="button" className={secondaryButton} onClick={() => setLines((rows) => (rows.length > 1 ? rows.filter((r) => r.key !== l.key) : [blank()]))}>Remove</button>
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-4 border-t border-line pt-4">
          <button type="button" className={secondaryButton} onClick={() => setLines((rows) => [...rows, blank()])}>Add a line</button>
          <p className="text-right">
            <span className="mr-4 font-mono text-[11px] uppercase tracking-[0.16em] text-mute">Invoice total</span>
            <span className="font-display text-3xl font-extrabold tabular-nums text-ink">{formatCents(total)}</span>
          </p>
        </div>
      </Card>

      <Card title="Message on the invoice (optional)">
        <textarea name="memo" rows={2} placeholder="For example: Move-out cleanup requested by the property manager on Nov 6." className={`${inputClass} h-auto py-2.5`} />
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={pending} className={secondaryButton}>{pending ? "Saving..." : "Save as draft"}</button>
        <button type="button" disabled={pending} className={primaryButton} onClick={(e) => submit("approve", e.currentTarget.form!)}>
          {pending ? "Saving..." : "Save and approve"}
        </button>
        <span className="text-sm text-mute">Approving assigns the invoice number and adds it to the customer&apos;s balance. Nothing is emailed until you send it.</span>
      </div>
    </form>
  );
}
