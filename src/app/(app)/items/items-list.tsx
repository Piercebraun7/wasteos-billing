"use client";

import { useState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { Field, inputClass, primaryButton, secondaryButton } from "@/components/ui";
import { centsToInput, formatCents } from "@/lib/money";
import { SERVICE_ORDER, SERVICES, type ServiceCategory } from "@/lib/services";
import { removeItem, saveItem } from "../invoices/actions";

export type Item = { id: string; name: string; category: string; description: string | null; default_rate_cents: number | null; is_active: boolean };

const rateInput = (cents: number | null) => (cents == null ? "" : (cents < 0 ? "-" : "") + centsToInput(Math.abs(cents)));

function Editor({ item, onClose }: { item: Item | null; onClose: () => void }) {
  const [category, setCategory] = useState<string>(item?.category ?? "bulk");
  return (
    <div className="rounded-3xl border border-ink/15 bg-white p-5 shadow-xl shadow-slate-900/5 sm:p-6">
      <form action={saveItem} className="space-y-4">
        {item && <input type="hidden" name="item_id" value={item.id} />}
        {item && <input type="hidden" name="is_active" value="on" />}
        <input type="hidden" name="category" value={category} />
        <div className="grid gap-4 sm:grid-cols-[1.6fr_1fr]">
          <Field label="Name">
            <input name="name" defaultValue={item?.name ?? ""} autoFocus placeholder="For example: Scheduled Bulk Waste Service" className={inputClass} />
          </Field>
          <Field label="Price" hint="Leave empty to type it in each time. Use a minus sign for a discount.">
            <input name="rate" inputMode="decimal" defaultValue={rateInput(item?.default_rate_cents ?? null)} placeholder="0.00" className={`${inputClass} text-right tabular-nums`} />
          </Field>
        </div>
        <Field label="Description on the invoice (optional)">
          <input name="description" defaultValue={item?.description ?? ""} className={inputClass} />
        </Field>
        <div>
          <p className="mb-1.5 text-[13px] font-medium text-slate-600">Service</p>
          <div className="flex flex-wrap gap-2">
            {SERVICE_ORDER.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCategory(c)}
                aria-pressed={category === c}
                className={`flex items-center gap-2 rounded-full border px-3.5 py-2 text-sm font-medium transition ${category === c ? "border-ink bg-ink text-white" : "border-line bg-white text-slate-700 hover:bg-slate-50"}`}
              >
                <span className="size-2.5 rounded-full" style={{ backgroundColor: SERVICES[c].hex }} aria-hidden />
                {SERVICES[c].label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
          <SubmitButton className={primaryButton}>{item ? "Save changes" : "Add to the list"}</SubmitButton>
          <button type="button" className={secondaryButton} onClick={onClose}>Cancel</button>
        </div>
      </form>
      {item && (
        <form action={removeItem} className="mt-3">
          <input type="hidden" name="item_id" value={item.id} />
          <input type="hidden" name="name" value={item.name} />
          <SubmitButton className="text-sm font-medium text-red-600 underline-offset-4 hover:underline">Remove {item.name}</SubmitButton>
        </form>
      )}
    </div>
  );
}

export function ItemsList({ items }: { items: Item[] }) {
  const [editing, setEditing] = useState<string | null>(null); // an item id, or "new"
  const [search, setSearch] = useState("");
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = items.filter((i) => i.is_active && words.every((w) => `${i.name} ${i.description ?? ""}`.toLowerCase().includes(w)));
  const archived = items.filter((i) => !i.is_active);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search products and services"
          aria-label="Search products and services"
          className="h-12 min-w-56 flex-1 rounded-full border border-line bg-white px-5 text-[15px] text-ink outline-none transition placeholder:text-slate-400 focus:border-ink focus:ring-4 focus:ring-ink/10"
        />
        <button type="button" className={primaryButton} onClick={() => setEditing("new")}>New product or service</button>
      </div>

      {editing === "new" && <Editor item={null} onClose={() => setEditing(null)} />}

      {SERVICE_ORDER.map((category) => {
        const group = shown.filter((i) => i.category === category);
        if (group.length === 0) return null;
        const service = SERVICES[category as ServiceCategory];
        return (
          <section key={category}>
            <h2 className="mb-2 flex items-center gap-2 font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-mute">
              <span className="size-2.5 rounded-full" style={{ backgroundColor: service.hex }} aria-hidden />
              {service.label}
            </h2>
            <ul className="overflow-hidden rounded-3xl border border-line bg-white shadow-[0_1px_2px_rgb(16_24_40/0.04)]">
              {group.map((item) =>
                editing === item.id ? (
                  <li key={item.id} className="border-b border-line bg-slate-50/60 p-3 last:border-b-0">
                    <Editor item={item} onClose={() => setEditing(null)} />
                  </li>
                ) : (
                  <li key={item.id} className="border-b border-line last:border-b-0">
                    <button type="button" onClick={() => setEditing(item.id)} className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition hover:bg-slate-50">
                      <span className="min-w-0">
                        <span className="block truncate text-[16px] font-medium text-ink">{item.name}</span>
                        {item.description && <span className="block truncate text-sm text-mute">{item.description}</span>}
                      </span>
                      <span className={`shrink-0 text-[17px] font-semibold tabular-nums ${item.default_rate_cents == null ? "text-sm font-normal text-mute" : "text-ink"}`}>
                        {item.default_rate_cents == null ? "Price set each time" : formatCents(item.default_rate_cents)}
                      </span>
                    </button>
                  </li>
                ),
              )}
            </ul>
          </section>
        );
      })}

      {shown.length === 0 && <p className="rounded-3xl border border-dashed border-slate-300 px-6 py-12 text-center text-mute">Nothing matches that search.</p>}

      {archived.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer font-medium text-mute">No longer in use ({archived.length})</summary>
          <ul className="mt-2 space-y-1">
            {archived.map((item) => (
              <li key={item.id}>
                <form action={saveItem} className="flex items-center gap-3">
                  <input type="hidden" name="item_id" value={item.id} />
                  <input type="hidden" name="name" value={item.name} />
                  <input type="hidden" name="category" value={item.category} />
                  <input type="hidden" name="description" value={item.description ?? ""} />
                  <input type="hidden" name="rate" value={rateInput(item.default_rate_cents)} />
                  <input type="hidden" name="is_active" value="on" />
                  <span className="text-slate-600">{item.name}</span>
                  <SubmitButton className="font-medium text-ink underline-offset-4 hover:underline">Bring back</SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
