import Link from "next/link";
import { SubmitButton } from "@/components/submit-button";
import { Card, Empty, Eyebrow, inputClass, Notice, PageHeader, primaryButton, secondaryButton } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { invoiceEmail } from "@/lib/email/invoice-email";
import { emailIsConnected } from "@/lib/email/resend";
import { formatDate } from "@/lib/format";
import { formatCents } from "@/lib/money";
import { isServiceCategory, SERVICE_ORDER, SERVICES, type ServiceCategory } from "@/lib/services";
import { InvoiceTabs } from "@/components/section-tabs";
import { sendAll, sendOne } from "./actions";

type Invoice = { id: string; account_id: string; invoice_number: number; total_cents: number; due_date: string; service_month: string; kind: string; service_category: string | null };
type Account = { id: string; property: { name: string }; customer: { name: string }; contacts: { name: string; email: string; is_active: boolean; delivery: string }[] };
type Log = { id: string; subject: string | null; recipients: string[]; sent_at: string; delivered_at: string | null; bounced_at: string | null; opened_at: string | null; provider_message_id: string | null };

export default async function SendPage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string; service?: string }> }) {
  const { supabase, name } = await requireAdmin();
  const { saved, error, service } = await searchParams;
  const view: ServiceCategory | "all" = isServiceCategory(service) ? service : "all";
  const [invoicesRes, accountsRes, defaultsRes, logRes, settings, overviewRes] = await Promise.all([
    supabase.from("invoices").select("id, account_id, invoice_number, total_cents, due_date, service_month, kind, service_category").eq("status", "approved").order("invoice_number"),
    supabase.from("billing_accounts").select("id, property:properties(name), customer:customers(name), contacts:billing_contacts(name, email, is_active, delivery)"),
    supabase.from("account_send_defaults").select("*"),
    supabase.from("email_sends").select("*").order("sent_at", { ascending: false }).limit(60),
    supabase.from("app_settings").select("email_sender, email_reply_to, copy_address").maybeSingle(),
    supabase.from("account_overview").select("account_id, balance_cents"),
  ]);
  const balances = new Map((overviewRes.data ?? []).map((o) => [o.account_id as string, Number(o.balance_cents)]));
  const waiting = (invoicesRes.data ?? []) as Invoice[];
  const categoryOf = (i: Invoice): ServiceCategory => (isServiceCategory(i.service_category) ? i.service_category : "other");
  const invoices = waiting.filter((i) => view === "all" || categoryOf(i) === view);
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
        eyebrow="Step 2 of 2"
        title="Invoices"
        description={`Approved invoices, ready to ship. One email per property with every invoice attached, sent from ${settings.data?.email_sender ?? "invoices@kaizen-waste.com"}.`}
        action={
          groups.length > 0 && connected ? (
            <form action={sendAll}>
              <input type="hidden" name="service" value={view} />
              <SubmitButton className={primaryButton}>
                Send {groups.length} {view === "all" ? "" : `${SERVICES[view].short.toLowerCase()} `}email{groups.length === 1 ? "" : "s"}
              </SubmitButton>
            </form>
          ) : undefined
        }
      />
      <InvoiceTabs supabase={supabase} current="send" />
      {saved && <Notice kind="ok">{saved}</Notice>}
      {error && <Notice kind="error">{error}</Notice>}
      {!connected && <Notice kind="info">Email is not connected yet, so nothing can be sent. Everything else on this page works, and sending switches on once the one-time email setup is done.</Notice>}

      <div className="flex w-fit flex-wrap gap-1 rounded-full border border-line bg-white p-1">
        {(["all", ...SERVICE_ORDER] as const).map((key) => {
          const count = key === "all" ? waiting.length : waiting.filter((i) => categoryOf(i) === key).length;
          if (key === "other" && count === 0) return null;
          return (
            <Link
              key={key}
              href={key === "all" ? "/send" : `/send?service=${key}`}
              aria-current={view === key ? "page" : undefined}
              className={`flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-medium transition ${view === key ? "bg-ink text-white" : "text-slate-600 hover:bg-slate-100"}`}
            >
              {key !== "all" && <span className="size-2.5 rounded-full" style={{ backgroundColor: SERVICES[key].hex }} aria-hidden />}
              {key === "all" ? "All" : SERVICES[key].label}
              <span className={`tabular-nums ${view === key ? "text-white/60" : "text-mute"}`}>{count}</span>
            </Link>
          );
        })}
      </div>

      {groups.length === 0 && <Empty>Nothing is waiting to be sent. Approved invoices appear here.</Empty>}

      {groups.map(({ account, invoices: list }) => {
        const contacts = account.contacts.filter((c) => c.is_active);
        const last = defaults.get(account.id);
        const remembered = new Set(((last?.recipient_emails as string[] | undefined) ?? []).map((e) => e.toLowerCase()));
        const total = list.reduce((sum, i) => sum + Number(i.total_cents), 0);
        const email = invoiceEmail({
          propertyName: account.property.name,
          invoices: list.map((i) => ({ number: Number(i.invoice_number), totalCents: Number(i.total_cents), dueDate: i.due_date, serviceMonth: i.service_month, kind: i.kind })),
          balanceCents: balances.get(account.id) ?? 0,
          replyTo: settings.data?.email_reply_to ?? null,
        });
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
              <input type="hidden" name="service" value={view} />
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
                    {c.delivery === "cc" && <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wider text-mute">CC</span>}
                    {c.name} <span className="text-mute">{c.email}</span>
                  </label>
                ))}
              </div>
              <details className="mt-4 rounded-2xl border border-line">
                <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-ink">Read or edit the email</summary>
                <div className="space-y-3 border-t border-line p-4">
                  <label className="block">
                    <span className="mb-1.5 block text-[13px] font-medium text-slate-600">Subject</span>
                    <input name="subject" defaultValue={email.subject} className={inputClass} />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-[13px] font-medium text-slate-600">Message</span>
                    <textarea name="body" defaultValue={email.text} rows={14} className={`${inputClass} h-auto py-3 leading-relaxed`} />
                  </label>
                  <p className="text-xs text-mute">Changes apply to this email only. The invoice PDFs are attached automatically. Send all uses the standard wording.</p>
                </div>
              </details>
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
