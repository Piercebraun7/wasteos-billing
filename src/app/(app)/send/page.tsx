import Link from "next/link";
import { SubmitButton } from "@/components/submit-button";
import { Card, Empty, Eyebrow, inputClass, Notice, PageHeader, primaryButton, secondaryButton } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { emailIsConnected } from "@/lib/email/resend";
import { formatDate } from "@/lib/format";
import { formatCents } from "@/lib/money";
import { sendAll, sendOne } from "./actions";

type Invoice = { id: string; account_id: string; invoice_number: number; total_cents: number; due_date: string; kind: string };
type Account = { id: string; property: { name: string }; customer: { name: string }; contacts: { name: string; email: string; is_active: boolean }[] };
type Log = { id: string; subject: string | null; recipients: string[]; sent_at: string; delivered_at: string | null; bounced_at: string | null; opened_at: string | null; provider_message_id: string | null };

export default async function SendPage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  const { supabase, name } = await requireAdmin();
  const { saved, error } = await searchParams;
  const [invoicesRes, accountsRes, defaultsRes, logRes, settings] = await Promise.all([
    supabase.from("invoices").select("id, account_id, invoice_number, total_cents, due_date, kind").eq("status", "approved").order("invoice_number"),
    supabase.from("billing_accounts").select("id, property:properties(name), customer:customers(name), contacts:billing_contacts(name, email, is_active)"),
    supabase.from("account_send_defaults").select("*"),
    supabase.from("email_sends").select("*").order("sent_at", { ascending: false }).limit(60),
    supabase.from("app_settings").select("email_sender, copy_address").maybeSingle(),
  ]);
  const invoices = (invoicesRes.data ?? []) as Invoice[];
  const accounts = new Map(((accountsRes.data ?? []) as unknown as Account[]).map((a) => [a.id, a]));
  const defaults = new Map((defaultsRes.data ?? []).map((d) => [d.account_id as string, d]));
  const groups = [...new Set(invoices.map((i) => i.account_id))]
    .map((id) => ({ account: accounts.get(id)!, invoices: invoices.filter((i) => i.account_id === id) }))
    .filter((g) => g.account)
    .sort((a, b) => a.account.property.name.localeCompare(b.account.property.name));
  const connected = emailIsConnected();

  // One row per email in the log, even when it carried several invoices.
  const seen = new Set<string>();
  const log = ((logRes.data ?? []) as Log[]).filter((l) => {
    const key = l.provider_message_id ?? l.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Delivery"
        title="Send"
        description={`Approved invoices waiting to go out, one email per property with every invoice attached. They are sent from ${settings.data?.email_sender ?? "invoices@kaizen-waste.com"}.`}
        action={
          groups.length > 0 && connected ? (
            <form action={sendAll}>
              <SubmitButton className={primaryButton}>Send all {groups.length}</SubmitButton>
            </form>
          ) : undefined
        }
      />
      {saved && <Notice kind="ok">{saved}</Notice>}
      {error && <Notice kind="error">{error}</Notice>}
      {!connected && <Notice kind="info">Email is not connected yet, so nothing can be sent. Everything else on this page works, and sending switches on once the one-time email setup is done.</Notice>}

      {groups.length === 0 && <Empty>Nothing is waiting to be sent. Approved invoices appear here.</Empty>}

      {groups.map(({ account, invoices: list }) => {
        const contacts = account.contacts.filter((c) => c.is_active);
        const last = defaults.get(account.id);
        const remembered = new Set(((last?.recipient_emails as string[] | undefined) ?? []).map((e) => e.toLowerCase()));
        const total = list.reduce((sum, i) => sum + Number(i.total_cents), 0);
        return (
          <section key={account.id} className="rounded-3xl border border-line bg-white p-5 shadow-[0_1px_2px_rgb(16_24_40/0.04)] sm:p-7">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold tracking-tight text-ink">{account.property.name}</h2>
                <p className="text-sm text-mute">{account.customer.name}</p>
              </div>
              <p className="font-display text-3xl font-extrabold tabular-nums text-ink">{formatCents(total)}</p>
            </div>
            <ul className="mt-3 flex flex-wrap gap-2">
              {list.map((i) => (
                <li key={i.id}>
                  <Link href={`/invoices/${i.id}`} className="inline-flex items-center gap-2 rounded-full border border-line px-3 py-1.5 text-sm text-ink transition hover:bg-slate-50">
                    <span className="font-medium">Invoice {i.invoice_number}</span>
                    <span className="tabular-nums text-mute">{formatCents(Number(i.total_cents))} · due {formatDate(i.due_date)}</span>
                  </Link>
                </li>
              ))}
            </ul>

            <form action={sendOne} className="mt-5 border-t border-line pt-5">
              <input type="hidden" name="account_id" value={account.id} />
              <Eyebrow>Send to</Eyebrow>
              {contacts.length === 0 && (
                <p className="mt-2 text-sm text-red-700">
                  No contacts yet. Add one on the <Link href="/contacts" className="underline">Contacts</Link> page, or type an address below.
                </p>
              )}
              <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2">
                {contacts.map((c) => (
                  <label key={c.email} className="flex items-center gap-2 text-[15px] text-slate-700">
                    <input type="checkbox" name="to" value={c.email} defaultChecked={remembered.size === 0 || remembered.has(c.email.toLowerCase())} className="size-4" />
                    {c.name} <span className="text-mute">{c.email}</span>
                  </label>
                ))}
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-center">
                <input name="extra" placeholder="Add another email address (optional)" aria-label="Another email address" className={inputClass} />
                <label className="flex items-center gap-2 text-sm text-slate-600">
                  <input type="checkbox" name="copy_self" defaultChecked={last?.send_copy_to_self ?? false} className="size-4" /> Send copy to myself
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-600">
                  <input type="checkbox" name="copy_jr" defaultChecked={last?.send_to_jr ?? false} className="size-4" /> Send to JR
                </label>
                {connected ? <SubmitButton className={secondaryButton}>Send</SubmitButton> : <span className="text-sm text-mute">Email not connected</span>}
              </div>
            </form>
          </section>
        );
      })}

      <Card title="Send log" description={`The most recent emails. Signed in as ${name}.`}>
        {log.length === 0 ? (
          <p className="text-sm text-mute">Nothing has been sent yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {log.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate font-medium text-ink">{l.subject}</p>
                  <p className="truncate text-sm text-mute">{formatDate(l.sent_at)} · to {l.recipients.join(", ")}</p>
                </div>
                <span
                  className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ${
                    l.bounced_at ? "bg-red-50 text-red-700 ring-red-200" : l.opened_at ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : l.delivered_at ? "bg-sky-50 text-sky-700 ring-sky-200" : "bg-slate-50 text-slate-600 ring-slate-200"
                  }`}
                >
                  {l.bounced_at ? "Bounced" : l.opened_at ? "Opened" : l.delivered_at ? "Delivered" : "Sent"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
