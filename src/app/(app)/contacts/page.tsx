import Link from "next/link";
import { SubmitButton } from "@/components/submit-button";
import { dangerButton, Empty, Eyebrow, inputClass, Notice, PageHeader, primaryButton, secondaryButton } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { confirmContacts, removeContact, saveContact } from "../accounts/actions";

type Contact = { id: string; name: string; email: string; role: string | null; confirmed_at: string | null; source: string | null; created_at: string };
type Row = { id: string; property: { name: string }; customer: { name: string }; contacts: Contact[] };

export default async function ContactsPage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  const { supabase } = await requireAdmin();
  const { saved, error } = await searchParams;
  const { data, error: loadError } = await supabase
    .from("billing_accounts")
    .select("id, property:properties(name), customer:customers(name), contacts:billing_contacts(*)")
    .eq("status", "active");
  const rows = ((data ?? []) as unknown as Row[]).map((r) => ({
    ...r,
    contacts: [...r.contacts].sort((a, b) => a.created_at.localeCompare(b.created_at)),
    checked: r.contacts.length > 0 && r.contacts.every((c) => c.confirmed_at),
  }));
  // Properties still needing a check come first.
  rows.sort((a, b) => Number(a.checked) - Number(b.checked) || a.customer.name.localeCompare(b.customer.name) || a.property.name.localeCompare(b.property.name));
  const done = rows.filter((r) => r.checked).length;
  const returnTo = <input type="hidden" name="return_to" value="contacts" />;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Who gets the invoices"
        title="Contacts"
        description="Every property and the people its invoices are emailed to. Fix anything that is out of date, then confirm. Addresses carried over from QuickBooks are marked until you confirm them."
      />
      {saved && <Notice kind="ok">{saved}</Notice>}
      {error && <Notice kind="error">{error}</Notice>}
      {loadError && <Notice kind="error">Could not load contacts: {loadError.message}</Notice>}

      <div className="rounded-3xl border border-line bg-white p-5 sm:p-6">
        <div className="flex items-end justify-between gap-4">
          <Eyebrow>Checked</Eyebrow>
          <p className="font-display text-2xl font-extrabold tabular-nums text-ink">{done} of {rows.length}</p>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: rows.length ? `${Math.round((100 * done) / rows.length)}%` : "0%" }} />
        </div>
      </div>

      {rows.length === 0 && <Empty>No properties yet.</Empty>}

      {rows.map((r) => {
        const hidden = <input type="hidden" name="account_id" value={r.id} />;
        return (
          <section key={r.id} className="rounded-3xl border border-line bg-white p-5 shadow-[0_1px_2px_rgb(16_24_40/0.04)] sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold tracking-tight text-ink">
                  <Link href={`/accounts/${r.id}`} className="hover:underline">{r.property.name}</Link>
                </h2>
                <p className="text-sm text-mute">{r.customer.name}</p>
              </div>
              {r.contacts.length === 0 ? (
                <span className="rounded-full bg-red-50 px-3 py-1 text-xs font-medium text-red-700 ring-1 ring-red-200">No one to send to</span>
              ) : r.checked ? (
                <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200">
                  Confirmed {formatDate(r.contacts.map((c) => c.confirmed_at!).sort()[0])}
                </span>
              ) : (
                <form action={confirmContacts}>
                  {hidden}
                  <SubmitButton className={primaryButton}>These are right</SubmitButton>
                </form>
              )}
            </div>

            <div className="mt-4 space-y-2">
              {r.contacts.map((c) => (
                <div key={c.id} className="flex flex-wrap items-center gap-2">
                  <form action={saveContact} className="grid flex-1 gap-2 sm:grid-cols-[1fr_1.3fr_1fr_auto]">
                    {hidden}
                    {returnTo}
                    <input type="hidden" name="contact_id" value={c.id} />
                    <input name="name" defaultValue={c.name} aria-label="Contact name" className={inputClass} />
                    <input name="email" type="email" defaultValue={c.email} aria-label="Contact email" className={inputClass} />
                    <input name="role" defaultValue={c.role ?? ""} placeholder="Role" aria-label="Contact role" className={inputClass} />
                    <SubmitButton className={secondaryButton}>Save</SubmitButton>
                  </form>
                  <form action={removeContact}>
                    {hidden}
                    {returnTo}
                    <input type="hidden" name="contact_id" value={c.id} />
                    <SubmitButton className={dangerButton}>Remove</SubmitButton>
                  </form>
                  {!c.confirmed_at && c.source && <p className="w-full text-xs text-amber-700">From {c.source}. Not confirmed yet.</p>}
                </div>
              ))}
              <form action={saveContact} className="grid gap-2 border-t border-line pt-3 sm:grid-cols-[1fr_1.3fr_1fr_auto]">
                {hidden}
                {returnTo}
                <input name="name" placeholder="Name" aria-label="New contact name" className={inputClass} />
                <input name="email" type="email" placeholder="Email" aria-label="New contact email" className={inputClass} />
                <input name="role" placeholder="Role" aria-label="New contact role" className={inputClass} />
                <SubmitButton className={secondaryButton}>Add</SubmitButton>
              </form>
            </div>
          </section>
        );
      })}
    </div>
  );
}
