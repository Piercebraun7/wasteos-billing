"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Card, Field, inputClass, Notice, primaryButton, secondaryButton } from "@/components/ui";
import { addDays } from "@/lib/billing/dates";
import { formatDate } from "@/lib/format";
import { centsToInput, formatCents, lineAmountCents, parseSignedDollarsToCents } from "@/lib/money";
import { BLOCKS, type BlockKey, type TemplateOptions } from "@/lib/pdf/template";
import { SERVICE_ORDER, SERVICES, type ServiceCategory } from "@/lib/services";
import { createInvoice } from "../actions";

type Account = { account_id: string; property_name: string; customer_name: string; balance_cents: number };
export type Item = { id: string; name: string; category: string; description: string | null; default_rate_cents: number | null };
export type Line = { key: number; item: string; itemText: string; newCategory: string; date: string; description: string; quantity: string; rate: string };

let nextKey = 1;
const blank = (date = ""): Line => ({ key: nextKey++, item: "", itemText: "", newCategory: "other", date, description: "", quantity: "1", rate: "" });
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
  bulkRates,
  standardLayout,
  layouts,
}: {
  accounts: Account[];
  items: Item[];
  today: string;
  defaultNetDays: number;
  preselected: string;
  bulkRates: Record<string, number>;
  standardLayout: TemplateOptions;
  layouts: Record<string, TemplateOptions>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [accountId, setAccountId] = useState(accounts.some((a) => a.account_id === preselected) ? preselected : "");
  const [search, setSearch] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(today);
  const [netDays, setNetDays] = useState(defaultNetDays);
  const [lines, setLines] = useState<Line[]>(() => [blank(today)]);
  const [repeat, setRepeat] = useState(false);

  const [memo, setMemo] = useState("");
  // Blocks switched on or off for this invoice only. Anything not listed follows the property's template.
  const [choices, setChoices] = useState<Partial<Record<BlockKey, boolean>>>({});
  const templateLayout = layouts[accountId] ?? standardLayout;
  const layoutNow = { ...templateLayout, ...choices };

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

  // The preview redraws shortly after typing stops, so it does not flicker on every key.
  const previewData = JSON.stringify({
    accountId: selected ? accountId : "",
    invoiceDate,
    netDays,
    memo,
    options: choices,
    lines: lines.map((l) => ({ item: l.item ? items.find((i) => i.id === l.item)?.name ?? "" : l.itemText, description: l.description, quantity: l.quantity, rate: l.rate, date: l.date })),
  });
  const [shownData, setShownData] = useState(previewData);
  useEffect(() => {
    const t = setTimeout(() => setShownData(previewData), 600);
    return () => clearTimeout(t);
  }, [previewData]);
  const previewSrc = `/invoices/new/preview?d=${encodeURIComponent(shownData)}#toolbar=0&navpanes=0`;

  const update = (key: number, patch: Partial<Line>) => setLines((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  function chooseItem(key: number, itemId: string) {
    const item = items.find((i) => i.id === itemId);
    if (!item) return update(key, { item: "" });
    // Bulk work uses this property's normal price when it has one, otherwise the list price.
    const preset = item.category === "bulk" && item.default_rate_cents !== null ? bulkRates[accountId] : undefined;
    const cents = preset ?? item.default_rate_cents;
    update(key, { item: itemId, itemText: item.name, description: item.description || item.name, rate: cents != null ? (cents < 0 ? "-" : "") + centsToInput(Math.abs(cents)) : "" });
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
      <input type="hidden" name="layout_options" value={Object.keys(choices).length ? JSON.stringify(choices) : ""} />

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
        <div className="hidden grid-cols-[9.5rem_1.3fr_1.5fr_4.5rem_6.5rem_6.5rem_auto] gap-2 pb-2 font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-mute lg:grid">
          <span>Date of service</span><span>Product or service</span><span>Description</span><span className="text-right">Qty</span><span className="text-right">Rate</span><span className="text-right">Amount</span><span className="w-[4.6rem]" />
        </div>
        <div className="space-y-2">
          {lines.map((l, i) => (
            <div key={l.key} className="grid gap-2 lg:grid-cols-[9.5rem_1.3fr_1.5fr_4.5rem_6.5rem_6.5rem_auto]">
              <input type="date" name="line_date" value={l.date} onChange={(e) => update(l.key, { date: e.target.value })} aria-label={`Line ${i + 1} date of service`} className={inputClass} />
              <ItemPicker
                items={items}
                line={l}
                label={`Line ${i + 1} product or service`}
                onChoose={(id) => chooseItem(l.key, id)}
                onType={(text) => update(l.key, { item: "", itemText: text })}
                onCategory={(c) => update(l.key, { newCategory: c })}
              />
              <input name="line_description" value={l.description} onChange={(e) => update(l.key, { description: e.target.value })} placeholder="What was done" aria-label={`Line ${i + 1} description`} className={inputClass} />
              <input name="line_quantity" value={l.quantity} onChange={(e) => update(l.key, { quantity: e.target.value })} inputMode="decimal" aria-label={`Line ${i + 1} quantity`} className={`${inputClass} text-right tabular-nums`} />
              <input name="line_rate" value={l.rate} onChange={(e) => update(l.key, { rate: e.target.value })} inputMode="decimal" placeholder="0.00" aria-label={`Line ${i + 1} rate in dollars`} className={`${inputClass} text-right tabular-nums`} />
              <p className="flex h-11 items-center justify-end px-1 text-[15px] font-semibold tabular-nums text-ink">{amounts[i] === null ? "" : formatCents(amounts[i]!)}</p>
              <button type="button" className={secondaryButton} onClick={() => setLines((rows) => (rows.length > 1 ? rows.filter((r) => r.key !== l.key) : [blank(invoiceDate)]))}>Remove</button>
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-4 border-t border-line pt-4">
          <button type="button" className={secondaryButton} onClick={() => setLines((rows) => [...rows, blank(rows.at(-1)?.date || invoiceDate)])}>Add a line</button>
          <p className="text-right">
            <span className="mr-4 font-mono text-[11px] uppercase tracking-[0.16em] text-mute">Invoice total</span>
            <span className="font-display text-3xl font-extrabold tabular-nums text-ink">{formatCents(total)}</span>
          </p>
        </div>
      </Card>

      <Card title="Repeat">
        <label className="flex items-center gap-3 text-[15px] text-slate-700">
          <input type="checkbox" name="repeat" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} className="size-5" />
          Repeat this invoice every month
        </label>
        {repeat && (
          <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_12rem]">
            <Field label="Name for the schedule" hint="How it is labelled on the schedule of billing.">
              <input name="repeat_name" placeholder="For example: Monthly bulk trash" className={inputClass} />
            </Field>
            <Field label="Day of the month" hint="1 to 28.">
              <input name="repeat_day" inputMode="numeric" defaultValue={Math.min(28, Number(invoiceDate.slice(8, 10)) || 1)} className={inputClass} />
            </Field>
            <p className="text-sm text-mute sm:col-span-2">
              This invoice is created now. Starting next month, a draft with the same lines appears in the review queue on that day, where you can adjust it before approving.
            </p>
          </div>
        )}
      </Card>

      <Card title="Message on the invoice (optional)">
        <textarea name="memo" rows={2} value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="For example: Move-out cleanup requested by the property manager on Nov 6." className={`${inputClass} h-auto py-2.5`} />
      </Card>

      <Card title="Preview" description="How this invoice will look. Tick a block off or on for this invoice only; the property's template is not changed.">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <div>
            <div className="divide-y divide-line rounded-2xl border border-line">
              {BLOCKS.filter((b) => b.key !== "nextMonth" && b.key !== "serviceDates").map((b) => (
                <label key={b.key} className="flex cursor-pointer items-start gap-3 px-4 py-2.5">
                  <input
                    type="checkbox"
                    checked={layoutNow[b.key]}
                    onChange={(e) => {
                      const next = { ...choices };
                      // Back to what the template says: drop the choice, so the invoice keeps following the template.
                      if (e.target.checked === templateLayout[b.key]) delete next[b.key];
                      else next[b.key] = e.target.checked;
                      setChoices(next);
                    }}
                    className="mt-1 size-4"
                  />
                  <span>
                    <span className="block text-[15px] font-medium text-ink">
                      {b.label}
                      {b.key in choices && <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-amber-200">Changed for this invoice</span>}
                    </span>
                    <span className="block text-sm text-mute">{b.help}</span>
                  </span>
                </label>
              ))}
            </div>
            {Object.keys(choices).length > 0 && (
              <button type="button" className={`${secondaryButton} mt-3`} onClick={() => setChoices({})}>Back to the template</button>
            )}
            <p className="mt-3 text-sm text-mute">The preview shows the balance already owed as one figure. The issued invoice lists each unpaid invoice.</p>
          </div>
          <div className="overflow-hidden rounded-2xl border border-line bg-slate-50">
            <iframe key={previewSrc} src={previewSrc} title="Invoice preview" className="h-[680px] w-full" />
          </div>
        </div>
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

/**
 * Type to find a product or service. Matches narrow as you type. If nothing
 * matches, what you typed can be added as a new one, saved with the invoice.
 */
export function ItemPicker({
  items, line, label, onChoose, onType, onCategory,
}: {
  items: Item[]; line: Line; label: string;
  onChoose: (id: string) => void; onType: (text: string) => void; onCategory: (category: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const typed = line.itemText.trim();
  const words = typed.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = items.filter((it) => words.every((w) => `${it.name} ${SERVICES[it.category as ServiceCategory]?.label ?? ""}`.toLowerCase().includes(w))).slice(0, 8);
  const exact = items.find((it) => it.name.toLowerCase() === typed.toLowerCase());
  const isNew = !line.item && typed !== "" && !exact;
  return (
    <div className="relative">
      <input type="hidden" name="line_item" value={line.item} />
      <input type="hidden" name="line_item_new" value={isNew ? typed : ""} />
      <input type="hidden" name="line_item_new_category" value={line.newCategory} />
      <input
        value={line.itemText}
        onChange={(e) => { onType(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => { setOpen(false); if (exact && !line.item) onChoose(exact.id); }}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          if (matches[0] && !isNew) onChoose(matches[0].id);
          setOpen(false);
        }}
        placeholder="Type to find or add"
        aria-label={label}
        autoComplete="off"
        className={inputClass}
      />
      {open && (
        <ul className="absolute left-0 top-full z-20 mt-1 max-h-72 w-full min-w-[22rem] overflow-auto rounded-2xl border border-line bg-white py-1 shadow-xl">
          {matches.map((it) => (
            <li key={it.id}>
              <button type="button" onMouseDown={(e) => { e.preventDefault(); onChoose(it.id); setOpen(false); }} className="flex w-full items-center justify-between gap-3 px-3.5 py-2 text-left text-[15px] hover:bg-slate-50">
                <span className="flex items-center gap-2 text-ink">
                  <span className="size-2 rounded-full" style={{ backgroundColor: SERVICES[it.category as ServiceCategory]?.hex ?? "#94a3b8" }} aria-hidden />
                  {it.name}
                </span>
                <span className="text-sm tabular-nums text-mute">{it.default_rate_cents != null ? formatCents(it.default_rate_cents) : ""}</span>
              </button>
            </li>
          ))}
          {matches.length === 0 && typed === "" && <li className="px-3.5 py-2 text-sm text-mute">No products or services yet. Type a name to add one.</li>}
          {isNew && (
            <li className="border-t border-line px-3.5 py-2 text-sm text-slate-700">
              <span className="font-medium text-ink">Add &ldquo;{typed}&rdquo; as a new product or service.</span> It is saved when you save this invoice.
            </li>
          )}
        </ul>
      )}
      {isNew && !open && (
        <div className="mt-1 flex items-center gap-2 text-xs text-mute">
          <span className="rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-800 ring-1 ring-amber-200">New</span>
          <select value={line.newCategory} onChange={(e) => onCategory(e.target.value)} aria-label="Service for the new product" className="h-7 rounded-lg border border-line bg-white px-1.5 text-xs text-ink">
            {SERVICE_ORDER.map((c) => (
              <option key={c} value={c}>{SERVICES[c as ServiceCategory].label}</option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
