"use client";

import { useState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { inputClass, primaryButton } from "@/components/ui";
import { centsToInput, formatCents, lineAmountCents, parseSignedDollarsToCents } from "@/lib/money";
import { ItemPicker, type Item, type Line } from "../new/invoice-form";
import { addDraftLine } from "../actions";

/** One blank line for adding an extra charge to a draft, with the same type-to-find product box as Create invoice. */
export function AddLine({ invoiceId, items, defaultDate, bulkRate }: { invoiceId: string; items: Item[]; defaultDate: string; bulkRate: number | null }) {
  const blank = (): Line => ({ key: 1, item: "", itemText: "", newCategory: "other", date: defaultDate, description: "", quantity: "1", rate: "" });
  const [line, setLine] = useState<Line>(blank);
  const rate = parseSignedDollarsToCents(line.rate);
  const amount = rate === null ? null : lineAmountCents(line.quantity || "1", rate);

  function choose(id: string) {
    const item = items.find((i) => i.id === id);
    if (!item) return setLine((l) => ({ ...l, item: "" }));
    // Bulk work uses this property's normal price when it has one, otherwise the list price.
    const cents = item.category === "bulk" && item.default_rate_cents !== null && bulkRate !== null ? bulkRate : item.default_rate_cents;
    setLine((l) => ({ ...l, item: id, itemText: item.name, description: item.description || item.name, rate: cents != null ? (cents < 0 ? "-" : "") + centsToInput(Math.abs(cents)) : "" }));
  }

  return (
    <form action={addDraftLine} className="space-y-2">
      <input type="hidden" name="invoice_id" value={invoiceId} />
      <div className="grid gap-2 sm:grid-cols-[9.5rem_1fr]">
        <input type="date" name="line_date" value={line.date} onChange={(e) => setLine({ ...line, date: e.target.value })} aria-label="Date of service" className={inputClass} />
        <ItemPicker items={items} line={line} label="Product or service" onChoose={choose} onType={(text) => setLine({ ...line, item: "", itemText: text })} onCategory={(c) => setLine({ ...line, newCategory: c })} />
      </div>
      <input name="description" value={line.description} onChange={(e) => setLine({ ...line, description: e.target.value })} placeholder="What was done" aria-label="Description" className={inputClass} />
      <div className="grid items-center gap-2 sm:grid-cols-[5rem_7rem_1fr_auto]">
        <input name="quantity" value={line.quantity} onChange={(e) => setLine({ ...line, quantity: e.target.value })} inputMode="decimal" aria-label="Quantity" className={`${inputClass} text-right tabular-nums`} />
        <input name="rate" value={line.rate} onChange={(e) => setLine({ ...line, rate: e.target.value })} inputMode="decimal" placeholder="Rate" aria-label="Rate in dollars" className={`${inputClass} text-right tabular-nums`} />
        <p className="px-1 text-[15px] font-semibold tabular-nums text-ink">{amount === null ? "" : formatCents(amount)}</p>
        <SubmitButton className={primaryButton}>Add to invoice</SubmitButton>
      </div>
    </form>
  );
}
