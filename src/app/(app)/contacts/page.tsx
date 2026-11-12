import Link from "next/link";
import { SubmitButton } from "@/components/submit-button";
import { Empty, Eyebrow, inputClass, Notice, PageHeader, primaryButton, secondaryButton } from "@/components/ui";
import { PropertyTabs } from "@/components/section-tabs";
import { requireAdmin } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { confirmContacts, removeContact, saveContact } from "../accounts/actions";

type Contact = { id: string; name: string; email: string; role: string | null; delivery: string; confirmed_at: string | null; source: string | null; created_at: string };
type Row = { id: string; property: { name: string }; customer: { name: string }; contacts: Contact[] };

function AddForm({ accountId, delivery, another }: { accountId: string; delivery: "to" | "cc"; another: boolean }) {
  return (
    <details className="group">
      <summary className={`${secondaryButton} cursor-pointer list-none`}>{delivery === "to" ? (another ? "Add another contact" : "Add contact") : another ? "Add another CC" : "Add CC"}</summary>
      <form action={saveContact} className="mt-3 grid gap-2 rounded-2xl border border-line bg-slate-50/70 p-3 sm:grid-cols-[1fr_1.3fr_auto]">
        <input type="hidden" name="account_id" value={accountId} />
        <input type="hidden" name="return_to" value="contacts" />
        <input type="hidden" name="delivery" value={delivery} />
        <input name="name" placeholder="Name" aria-label="Name" className={inputClass} />
        <input name="email" type="email" placeholder="Email" aria-label="Email" className={inputClass} />
        <SubmitButton className={primaryButton}>{delivery === "to" ? "Add to the To line" : "Add as CC"}</SubmitButton>
      </form>
    </details>
  );
}

export default async function ContactsPage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  const { supabase } = await requireAdmin();
  const { saved, error } = await searchParams;
  const { data, error: loadError } = await supabase
    .from("billing_accounts")
    .select("id, property:properties(name), customer:customers(name), contacts:billing_contacts(*)")
    .eq("status", "active");
  const rows = ((data ?? []) as unknown as Row[]).map((r) => ({
    ...r,
    contacts: [...r.contacts].sort((a, b) => Number(a.delivery === "cc") - Number(b.delivery === "cc") || a.created_at.localeCompare(b.created_at)),
    checked: r.contacts.some((c) => c.delivery !== "cc") && r.contacts.every((c) => c.confirmed_at),
  }));
  rows.sort((a, b) => Number(a.checked) - Number(b.checked) || a.customer.name.localeCompare(b.customer.name) || a.property.name.localeCompare(b.property.name));
  const done = rows.filter((r) => r.checked).length;

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Who gets the invoices" title="Properties" description="Invoices go to the people in each property's To line, with anyone marked CC copied." />
      <PropertyTabs current="contacts" />
      {saved && <Notice kind="ok">{saved}</Notice>}
      {error && <Notice kind="error">{error}</Notice>}
      {loadError && <Notice kind="error">Could not load contacts: {loadError.message}</Notice>}

      <div className="rounded-3xl border border-line bg-white p-5 sm:p-6">
        <div className="flex items-end justify-between gap-4">
          <Eyebrow>Properties checked</Eyebrow>
          <p className="font-display text-2xl font-extrabold tabular-nums text-ink">{done} of {rows.length}</p>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full rounded-full bg-emerald-500" style={{ width: rows.length ? `${Math.round((100 * done) / rows.length)}%` : "0%" }} />
        </div>
      </div>

      {rows.length === 0 && <Empty>No properties yet.</Empty>}

      <div className="grid gap-4 xl:grid-cols-2">
        {rows.map((r) => {
          const to = r.contacts.filter((c) => c.delivery !== "cc");
          return (
            <section key={r.id} className="rounded-3xl border border-line bg-white p-5 shadow-[0_1px_2px_rgb(16_24_40/0.04)] sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate text-lg font-semibold tracking-tight text-ink">
                    <Link href={`/accounts/${r.id}`} className="hover:underline">{r.property.name}</Link>
                  </h2>
                  <p className="text-sm text-mute">{r.customer.name}</p>
                </div>
                {to.length === 0 ? (
                  <span className="rounded-full bg-red-50 px-3 py-1 text-xs font-medium text-red-700 ring-1 ring-red-200">No one in the To line</span>
                ) : r.checked ? (
                  <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200">
                    Confirmed {formatDate(r.contacts.map((c) => c.confirmed_at!).sort()[0])}
                  </span>
                ) : (
                  <form action={confirmContacts}>
                    <input type="hidden" name="account_id" value={r.id} />
                    <SubmitButton className={primaryButton}>These are right</SubmitButton>
                  </form>
                )}
              </div>

              <ul className="mt-4 divide-y divide-line">
                {r.contacts.map((c) => (
                  <li key={c.id} className="py-2.5">
                    <details>
                      <summary className="flex cursor-pointer list-none items-center gap-3">
                        <span className={`w-9 shrink-0 rounded-md py-0.5 text-center font-mono text-[10px] font-semibold uppercase tracking-wider ${c.delivery === "cc" ? "bg-slate-100 text-slate-600" : "bg-ink text-white"}`}>
                          {c.delivery === "cc" ? "CC" : "To"}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium text-ink">{c.name}</span>
                          <span className="block truncate text-sm text-mute">{c.email}</span>
                        </span>
                        {!c.confirmed_at && <span className="shrink-0 text-xs text-amber-700">{c.source ? `From ${c.source}` : "Not confirmed"}</span>}
                        <span className="shrink-0 text-sm font-medium text-ink underline-offset-4 hover:underline">Edit</span>
                      </summary>
                      <div className="mt-3 flex flex-wrap items-end gap-2 rounded-2xl border border-line bg-slate-50/70 p-3">
                        <form action={saveContact} className="grid flex-1 gap-2 sm:grid-cols-[1fr_1.3fr_6rem_auto]">
                          <input type="hidden" name="account_id" value={r.id} />
                          <input type="hidden" name="return_to" value="contacts" />
                          <input type="hidden" name="contact_id" value={c.id} />
                          <input type="hidden" name="role" value={c.role ?? ""} />
                          <input name="name" defaultValue={c.name} aria-label="Name" className={inputClass} />
                          <input name="email" type="email" defaultValue={c.email} aria-label="Email" className={inputClass} />
                          <select name="delivery" defaultValue={c.delivery === "cc" ? "cc" : "to"} aria-label="To or CC" className={inputClass}>
                            <option value="to">To</option>
                            <option value="cc">CC</option>
                          </select>
                          <SubmitButton className={primaryButton}>Save</SubmitButton>
                        </form>
                        <form action={removeContact}>
                          <input type="hidden" name="account_id" value={r.id} />
                          <input type="hidden" name="return_to" value="contacts" />
                          <input type="hidden" name="contact_id" value={c.id} />
                          <SubmitButton className="h-11 rounded-full px-4 text-sm font-medium text-red-600 hover:bg-red-50">Remove</SubmitButton>
                        </form>
                      </div>
                    </details>
                  </li>
                ))}
              </ul>

              <div className="mt-3 flex flex-wrap items-start gap-2 border-t border-line pt-4">
                <AddForm accountId={r.id} delivery="to" another={to.length > 0} />
                <AddForm accountId={r.id} delivery="cc" another={r.contacts.length > to.length} />
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
