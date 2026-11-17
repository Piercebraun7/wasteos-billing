import Link from "next/link";
import { Empty, Eyebrow, PageHeader, primaryButton } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { addDays, todayInPhoenix } from "@/lib/billing/dates";
import { listIncreases } from "@/lib/billing/increases";
import { formatDate } from "@/lib/format";
import { formatCents } from "@/lib/money";

type Inv = { id: string; account_id: string; invoice_number: number | null; status: string; invoice_date: string; due_date: string; total_cents: number; account: { property: { name: string } } };

function Section({ title, count, note, href, action, children }: { title: string; count: number; note: string; href: string; action: string; children: React.ReactNode }) {
  if (count === 0) return null;
  return (
      <section className="overflow-hidden rounded-3xl border border-line bg-white shadow-[0_1px_2px_rgb(16_24_40/0.04)]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-5 sm:px-7">
          <div>
            <h2 className="text-xl font-semibold tracking-tight text-ink"><span className="font-display mr-2 tabular-nums">{count}</span>{title}</h2>
            <p className="mt-1 text-sm text-mute">{note}</p>
          </div>
          <Link href={href} className={primaryButton}>{action}</Link>
        </div>
        <ul className="divide-y divide-line">{children}</ul>
      </section>
  );
}

function Row({ href, left, middle, right }: { href: string; left: string; middle: string; right: string }) {
  return (
    <li>
      <Link href={href} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 py-3 transition hover:bg-slate-50 sm:px-7">
        <span className="font-medium text-ink">{left}</span>
        <span className="flex-1 text-sm text-mute">{middle}</span>
        <span className="font-semibold tabular-nums text-ink">{right}</span>
      </Link>
    </li>
  );
}

/** Everything waiting to be sent to customers on Kaizen's behalf, in one place. Nothing here sends itself. */
export default async function OutboxPage() {
  const { supabase } = await requireAdmin();
  const today = todayInPhoenix();
  const [invoices, applications, credits, reminded] = await Promise.all([
    supabase.from("invoices").select("id, account_id, invoice_number, status, invoice_date, due_date, total_cents, account:billing_accounts(property:properties(name))").in("status", ["draft", "approved", "sent", "partially_paid"]),
    supabase.from("payment_applications").select("invoice_id, amount_cents"),
    supabase.from("credit_memos").select("invoice_id, amount_cents"),
    supabase.from("email_sends").select("invoice_id").eq("kind", "reminder"),
  ]);
  const rows = (invoices.data ?? []) as unknown as Inv[];
  const reduced = new Map<string, number>();
  for (const r of [...(applications.data ?? []), ...(credits.data ?? [])]) if (r.invoice_id) reduced.set(r.invoice_id, (reduced.get(r.invoice_id) ?? 0) + Number(r.amount_cents));
  const remindedIds = new Set((reminded.data ?? []).map((r) => r.invoice_id as string));
  const byName = (a: Inv, b: Inv) => a.account.property.name.localeCompare(b.account.property.name);

  const drafts = rows.filter((r) => r.status === "draft").sort(byName);
  const ready = rows.filter((r) => r.status === "approved").sort(byName);
  const reminders = rows
    .filter((r) => ["sent", "partially_paid"].includes(r.status) && addDays(r.due_date, 5) < today && !remindedIds.has(r.id))
    .map((r) => ({ ...r, open: Number(r.total_cents) - (reduced.get(r.id) ?? 0) }))
    .filter((r) => r.open > 0)
    .sort((a, b) => a.due_date.localeCompare(b.due_date));
  const increases = await listIncreases(supabase, today, addDays(today, 200)).catch(() => []);
  const notices = increases.filter((r) => r.status === "planned" && r.effective > today && r.noticeDue <= addDays(today, 14));
  const nothing = drafts.length + ready.length + reminders.length + notices.length === 0;

  return (
    <div className="space-y-6">
      <PageHeader eyebrow={formatDate(today)} title="Going out" description="Everything waiting to be sent to customers. Nothing here goes out until you send it." />
      {nothing && <Empty>Nothing is waiting to go out.</Empty>}

      <Section title={`invoice${ready.length === 1 ? "" : "s"} approved and ready to send`} count={ready.length} note="Approved and on the books, not yet emailed." href="/send" action="Go to Send">
        {ready.map((r) => <Row key={r.id} href={`/invoices/${r.id}`} left={r.account.property.name} middle={`Invoice ${r.invoice_number} · due ${formatDate(r.due_date)}`} right={formatCents(Number(r.total_cents))} />)}
      </Section>

      <Section title={`draft${drafts.length === 1 ? "" : "s"} to review`} count={drafts.length} note="Check and approve these first. Approved invoices then move to Send." href="/review" action="Go to Review">
        {drafts.map((r) => <Row key={r.id} href={`/invoices/${r.id}`} left={r.account.property.name} middle={`Draft · dated ${formatDate(r.invoice_date)}`} right={formatCents(Number(r.total_cents))} />)}
      </Section>

      <Section title={`overdue invoice${reminders.length === 1 ? "" : "s"} awaiting a notice`} count={reminders.length} note="More than five days past due and still unpaid. Each property gets one notice covering all of its overdue invoices." href="/invoices?view=unpaid" action="Go to overdue notices">
        {reminders.map((r) => <Row key={r.id} href={`/invoices/${r.id}`} left={r.account.property.name} middle={`Invoice ${r.invoice_number} · was due ${formatDate(r.due_date)}`} right={formatCents(r.open)} />)}
      </Section>

      <Section title={`rate increase notice${notices.length === 1 ? "" : "s"} due`} count={notices.length} note="An annual increase is coming up and the customer has not been told yet." href="/increases" action="Go to rate increases">
        {notices.map((r) => <Row key={`${r.accountId}-${r.effective}`} href="/increases" left={r.propertyName} middle={`Takes effect ${formatDate(r.effective)} · notice due ${formatDate(r.noticeDue)}`} right="" />)}
      </Section>

      {!nothing && <Eyebrow>Sending is always your click. The daily job only drafts.</Eyebrow>}
    </div>
  );
}
