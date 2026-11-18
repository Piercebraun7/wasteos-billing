"use client";

import { useEffect, useState, useTransition } from "react";
import { BLOCKS, type BlockKey, type TemplateOptions } from "@/lib/pdf/template";
import { saveDraftLayout } from "./actions";

/**
 * Opens under a draft: the whole invoice on the right, and on the left the
 * blocks that can be switched on or off for this invoice only. The PDF is
 * not drawn until the panel is opened.
 */
export function DraftPreview({ invoiceId, template, saved, scheduled }: { invoiceId: string; template: TemplateOptions; saved: Partial<Record<BlockKey, boolean>>; scheduled: boolean }) {
  const [open, setOpen] = useState(false);
  const [choices, setChoices] = useState<Partial<Record<BlockKey, boolean>>>(saved);
  const [shown, setShown] = useState(choices);
  const [pending, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setShown(choices), 500);
    return () => clearTimeout(t);
  }, [choices]);
  const now = { ...template, ...choices };
  const unsaved = JSON.stringify(choices) !== JSON.stringify(saved);
  const src = `/invoices/${invoiceId}/pdf?o=${encodeURIComponent(JSON.stringify(shown))}#toolbar=0&navpanes=0&view=FitH`;
  const blocks = BLOCKS.filter((b) => scheduled || (b.key !== "nextMonth" && b.key !== "serviceDates"));

  return (
    <div className="border-t border-line">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center justify-between px-5 py-3 text-left text-sm font-medium text-ink transition hover:bg-slate-50 sm:px-7">
        <span>{open ? "Hide the invoice preview" : "Preview the invoice"}</span>
        <span aria-hidden className={`transition ${open ? "rotate-180" : ""}`}>&#9662;</span>
      </button>
      {open && (
        <div className="grid gap-5 border-t border-line bg-slate-50/60 p-5 sm:p-7 lg:grid-cols-[18rem_minmax(0,1fr)]">
          <div>
            <p className="font-mono text-[11px] font-medium uppercase tracking-wider text-mute">On this invoice</p>
            <div className="mt-2 divide-y divide-line rounded-2xl border border-line bg-white">
              {blocks.map((b) => (
                <label key={b.key} className="flex cursor-pointer items-start gap-2.5 px-3.5 py-2.5">
                  <input
                    type="checkbox"
                    checked={now[b.key]}
                    onChange={(e) => {
                      const next = { ...choices };
                      if (e.target.checked === template[b.key]) delete next[b.key];
                      else next[b.key] = e.target.checked;
                      setChoices(next);
                      setNote(null);
                    }}
                    className="mt-1 size-4"
                  />
                  <span className="text-sm">
                    <span className="block font-medium text-ink">{b.label}</span>
                    {b.key in choices && <span className="text-xs font-medium text-amber-700">Changed for this invoice</span>}
                  </span>
                </label>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={pending || !unsaved}
                onClick={() => start(async () => { const r = await saveDraftLayout(invoiceId, choices); setNote(r?.error ?? "Saved for this invoice."); })}
                className="h-10 rounded-full bg-ink px-4 text-sm font-semibold text-white disabled:opacity-40"
              >
                {pending ? "Saving..." : "Save for this invoice"}
              </button>
              {Object.keys(choices).length > 0 && <button type="button" onClick={() => { setChoices({}); setNote(null); }} className="h-10 rounded-full px-3 text-sm font-medium text-slate-600 hover:bg-slate-100">Back to the template</button>}
            </div>
            <p className="mt-2 text-xs text-mute">{note ?? (unsaved ? "The preview shows your changes. They only apply once saved." : "Only this invoice changes. The property's template stays as it is.")}</p>
          </div>
          <div className="overflow-hidden rounded-2xl border border-line bg-white">
            <iframe key={src} src={src} title="Invoice preview" className="h-[1040px] w-full" />
          </div>
        </div>
      )}
    </div>
  );
}
