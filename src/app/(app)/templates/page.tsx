import Link from "next/link";
import { SettingsTabs } from "@/components/section-tabs";
import { SubmitButton } from "@/components/submit-button";
import { Card, dangerButton, Field, inputClass, Notice, PageHeader, primaryButton, secondaryButton } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { BLOCKS, resolveOptions } from "@/lib/pdf/template";
import { addTemplate, makeDefault, removeTemplate, saveAssignment, saveCompanyDetails, saveTemplate } from "./actions";

type Template = { id: string; name: string; is_default: boolean; options: unknown };
type Account = { id: string; invoice_template_id: string | null; customer_reference: string | null; status: string; property: { name: string }; customer: { name: string } };

export default async function TemplatesPage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  const { supabase } = await requireAdmin();
  const { saved, error } = await searchParams;
  const [templatesRes, accountsRes, settings] = await Promise.all([
    supabase.from("invoice_templates").select("id, name, is_default, options").order("is_default", { ascending: false }).order("name"),
    supabase.from("billing_accounts").select("id, invoice_template_id, customer_reference, status, property:properties(name), customer:customers(name)").eq("status", "active"),
    supabase.from("app_settings").select("company_phone, company_email, remittance_address, ach_instructions").maybeSingle(),
  ]);
  const templates = (templatesRes.data ?? []) as Template[];
  const accounts = ((accountsRes.data ?? []) as unknown as Account[]).sort((a, b) => a.property.name.localeCompare(b.property.name));
  const fallback = templates.find((t) => t.is_default);
  const using = (id: string) => accounts.filter((a) => a.invoice_template_id === id).length;

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Set once" title="Settings" description="What prints on an invoice. One template covers every property; give a property its own when a customer needs something different." />
      <SettingsTabs current="templates" />
      {saved && <Notice kind="ok">{saved}</Notice>}
      {error && <Notice kind="error">{error}</Notice>}

      <Card title="Payment and contact details" description="Printed on invoices by any template that has the matching block switched on.">
        <form action={saveCompanyDetails} className="grid gap-4 sm:grid-cols-2">
          <Field label="Company phone">
            <input name="company_phone" defaultValue={settings.data?.company_phone ?? ""} className={inputClass} />
          </Field>
          <Field label="Billing email">
            <input name="company_email" type="email" defaultValue={settings.data?.company_email ?? ""} className={inputClass} />
          </Field>
          <Field label="Checks are mailed to" className="sm:col-span-2">
            <input name="remittance_address" required defaultValue={settings.data?.remittance_address ?? ""} className={inputClass} />
          </Field>
          <Field label="ACH details" hint="Bank name, account name, routing number and account number, one per line. Leave empty and the ACH block does not print." className="sm:col-span-2">
            <textarea name="ach_instructions" rows={4} defaultValue={settings.data?.ach_instructions ?? ""} autoComplete="off" className={`${inputClass} h-auto py-2.5`} />
          </Field>
          <div className="sm:col-span-2">
            <SubmitButton className={primaryButton}>Save details</SubmitButton>
          </div>
        </form>
      </Card>

      <div className="grid gap-5 xl:grid-cols-2">
        {templates.map((t) => {
          const options = resolveOptions(t.options);
          return (
            <Card
              key={t.id}
              title={t.is_default ? `${t.name} (default)` : t.name}
              description={t.is_default ? `Used by every property without its own template: ${accounts.length - accounts.filter((a) => a.invoice_template_id && a.invoice_template_id !== t.id).length} of ${accounts.length}.` : `Used by ${using(t.id)} propert${using(t.id) === 1 ? "y" : "ies"}.`}
            >
              <form action={saveTemplate} className="space-y-4">
                <input type="hidden" name="template_id" value={t.id} />
                <Field label="Template name">
                  <input name="name" required defaultValue={t.name} className={inputClass} />
                </Field>
                <div className="divide-y divide-line rounded-2xl border border-line">
                  {BLOCKS.map((b) => (
                    <label key={b.key} className="flex cursor-pointer items-start gap-3 px-4 py-3">
                      <input type="checkbox" name={b.key} defaultChecked={options[b.key]} className="mt-1 size-4" />
                      <span>
                        <span className="block text-[15px] font-medium text-ink">{b.label}</span>
                        <span className="block text-sm text-mute">{b.help}</span>
                      </span>
                    </label>
                  ))}
                </div>
                <Field label="Note on every invoice" hint="Optional. Prints under the charges, for example a thank you or a notice.">
                  <textarea name="note" rows={2} maxLength={600} defaultValue={options.note} className={`${inputClass} h-auto py-2.5`} />
                </Field>
                <div className="flex flex-wrap gap-2">
                  <SubmitButton className={primaryButton}>Save template</SubmitButton>
                  <Link href={`/templates/${t.id}/preview`} target="_blank" className={secondaryButton}>Preview saved version</Link>
                </div>
              </form>
              {!t.is_default && (
                <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">
                  <form action={makeDefault}>
                    <input type="hidden" name="template_id" value={t.id} />
                    <SubmitButton className={secondaryButton}>Make this the default</SubmitButton>
                  </form>
                  <form action={removeTemplate}>
                    <input type="hidden" name="template_id" value={t.id} />
                    <SubmitButton className={dangerButton}>Remove</SubmitButton>
                  </form>
                </div>
              )}
            </Card>
          );
        })}
      </div>

      <Card title="Add a template" description="Starts as a copy of the default. Adjust it, then choose below which properties use it.">
        <form action={addTemplate} className="flex flex-wrap gap-2">
          <input name="name" required placeholder="Name, for example Conservice properties" aria-label="New template name" className={`${inputClass} max-w-sm`} />
          <SubmitButton className={secondaryButton}>Add template</SubmitButton>
        </form>
      </Card>

      <Card title="Which template each property uses" description="Leave a property on Default unless its customer needs a different invoice. The account or PO number is optional and prints only where the customer has given you one.">
        <ul className="divide-y divide-line">
          {accounts.map((a) => (
            <li key={a.id} className="py-3">
              <form action={saveAssignment} className="grid items-center gap-2 sm:grid-cols-[1.4fr_1fr_1fr_auto]">
                <input type="hidden" name="account_id" value={a.id} />
                <span className="min-w-0">
                  <span className="block truncate text-[15px] font-medium text-ink">{a.property.name}</span>
                  <span className="block truncate text-sm text-mute">{a.customer.name}</span>
                </span>
                <select name="invoice_template_id" defaultValue={a.invoice_template_id ?? ""} aria-label={`Template for ${a.property.name}`} className={inputClass}>
                  <option value="">Default{fallback ? ` (${fallback.name})` : ""}</option>
                  {templates.filter((t) => !t.is_default).map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
                <input name="customer_reference" defaultValue={a.customer_reference ?? ""} placeholder="Account or PO number" aria-label={`Account or PO number for ${a.property.name}`} className={inputClass} />
                <SubmitButton className={secondaryButton}>Save</SubmitButton>
              </form>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
