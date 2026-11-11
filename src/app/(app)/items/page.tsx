import { SubmitButton } from "@/components/submit-button";
import { Card, inputClass, Notice, PageHeader, primaryButton, secondaryButton } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { centsToInput } from "@/lib/money";
import { SERVICE_ORDER, SERVICES } from "@/lib/services";
import { saveItem } from "../invoices/actions";

type Item = { id: string; name: string; category: string; description: string | null; default_rate_cents: number | null; is_active: boolean };
const rateInput = (cents: number | null) => (cents == null ? "" : (cents < 0 ? "-" : "") + centsToInput(Math.abs(cents)));

export default async function ItemsPage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  const { supabase } = await requireAdmin();
  const { saved, error } = await searchParams;
  const { data } = await supabase.from("service_items").select("*").order("sort_order").order("name");
  const items = (data ?? []) as Item[];
  const categorySelect = (value: string) => (
    <select name="category" defaultValue={value} aria-label="Service type" className={inputClass}>
      {SERVICE_ORDER.map((c) => (
        <option key={c} value={c}>{SERVICES[c].label}</option>
      ))}
    </select>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Setup"
        title="Products and services"
        description="The list you choose from when creating an invoice. A price is optional: leave it empty to type it in each time. Use a negative price for a discount."
      />
      {saved && <Notice kind="ok">{saved}</Notice>}
      {error && <Notice kind="error">{error}</Notice>}

      <Card title="Add a product or service">
        <form action={saveItem} className="grid gap-2 md:grid-cols-[1.4fr_1.1fr_1.6fr_7rem_auto]">
          <input name="name" placeholder="Name" aria-label="Name" className={inputClass} />
          {categorySelect("bulk")}
          <input name="description" placeholder="Description shown on the invoice" aria-label="Description" className={inputClass} />
          <input name="rate" inputMode="decimal" placeholder="Price" aria-label="Price in dollars" className={`${inputClass} text-right`} />
          <SubmitButton className={primaryButton}>Add</SubmitButton>
        </form>
      </Card>

      <Card title="Current list">
        <div className="space-y-2">
          {items.map((item) => (
            <form key={item.id} action={saveItem} className="grid items-center gap-2 md:grid-cols-[1.4fr_1.1fr_1.6fr_7rem_auto_auto]">
              <input type="hidden" name="item_id" value={item.id} />
              <input name="name" defaultValue={item.name} aria-label="Name" className={inputClass} />
              {categorySelect(item.category)}
              <input name="description" defaultValue={item.description ?? ""} placeholder="Description" aria-label="Description" className={inputClass} />
              <input name="rate" inputMode="decimal" defaultValue={rateInput(item.default_rate_cents)} placeholder="Price" aria-label="Price in dollars" className={`${inputClass} text-right tabular-nums`} />
              <label className="flex items-center gap-1.5 text-sm text-slate-600">
                <input type="checkbox" name="is_active" defaultChecked={item.is_active} className="size-4" /> In use
              </label>
              <SubmitButton className={secondaryButton}>Save</SubmitButton>
            </form>
          ))}
        </div>
      </Card>
    </div>
  );
}
