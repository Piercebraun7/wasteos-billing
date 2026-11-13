"use client";

import { useEffect, useState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { Field, inputClass, primaryButton } from "@/components/ui";
import { BLOCKS, type TemplateOptions } from "@/lib/pdf/template";
import { saveTemplate } from "./actions";

/** Tick boxes on the left, a sample invoice on the right that redraws as they change. */
export function TemplateEditor({ id, name, initial }: { id: string; name: string; initial: TemplateOptions }) {
  const [options, setOptions] = useState<TemplateOptions>(initial);
  const [shown, setShown] = useState<TemplateOptions>(initial);
  // Wait for a pause in typing or ticking before redrawing, so the preview does not flicker.
  useEffect(() => {
    const t = setTimeout(() => setShown(options), 500);
    return () => clearTimeout(t);
  }, [options]);
  const changed = JSON.stringify(options) !== JSON.stringify(initial);
  const src = `/templates/${id}/preview?o=${encodeURIComponent(JSON.stringify(shown))}#toolbar=0&navpanes=0`;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
      <form action={saveTemplate} className="space-y-4">
        <input type="hidden" name="template_id" value={id} />
        <Field label="Template name">
          <input name="name" required defaultValue={name} className={inputClass} />
        </Field>
        <div className="divide-y divide-line rounded-2xl border border-line">
          {BLOCKS.map((b) => (
            <label key={b.key} className="flex cursor-pointer items-start gap-3 px-4 py-3">
              <input
                type="checkbox"
                name={b.key}
                checked={options[b.key]}
                onChange={(e) => setOptions({ ...options, [b.key]: e.target.checked })}
                className="mt-1 size-4"
              />
              <span>
                <span className="block text-[15px] font-medium text-ink">{b.label}</span>
                <span className="block text-sm text-mute">{b.help}</span>
              </span>
            </label>
          ))}
        </div>
        <Field label="Note on every invoice" hint="Optional. Prints under the charges, for example a thank you or a notice.">
          <textarea
            name="note"
            rows={2}
            maxLength={600}
            value={options.note}
            onChange={(e) => setOptions({ ...options, note: e.target.value })}
            className={`${inputClass} h-auto py-2.5`}
          />
        </Field>
        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton className={primaryButton}>Save template</SubmitButton>
          {changed && <span className="text-sm text-amber-700">Not saved yet. The preview shows your changes; invoices use the saved version.</span>}
        </div>
      </form>
      <div className="lg:sticky lg:top-6 lg:self-start">
        <p className="mb-2 font-mono text-[11px] font-medium uppercase tracking-wider text-mute">Preview, made-up numbers</p>
        <div className="overflow-hidden rounded-2xl border border-line bg-slate-50">
          <iframe key={src} src={src} title={`Preview of the ${name} template`} className="h-[640px] w-full" />
        </div>
      </div>
    </div>
  );
}
