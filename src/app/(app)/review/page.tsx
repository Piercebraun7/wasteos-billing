import Link from "next/link";
import { SubmitButton } from "@/components/submit-button";
import { Card, dangerButton, Empty, Eyebrow, inputClass, Notice, PageHeader, primaryButton, secondaryButton } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { monthEnd, monthLabel, todayInPhoenix } from "@/lib/billing/dates";
import { formatDate } from "@/lib/format";
import { centsToInput, formatCents } from "@/lib/money";
import { isServiceCategory, SERVICES } from "@/lib/services";
import { approveAll, approveInvoice, generateDraftsAction, rejectDraft, setNextInvoiceNumber, updateDraftLine } from "./actions";

type Line = { id: string; description: string; amount_cents: number; sort_order: number; contract_phase_id: string | null; line_type: string };
type Draft = {
  id: string;
  account_id: string;
  service_month: string;
  invoice_date: string;
  due_date: string;
  total_cents: number;
  kind: string;
  service_category: string | null;
  memo: string | null;
  lines: Line[];
  account: { property: { id: string; name: string }; customer: { name: string }; contacts: { id: string }[] };
};
type Posted = { id: string; account_id: string; invoice_number: number | null; service_month: string; total_cents: number; origin: string; kind: string; service_category: string | null; lines: Line[] };

export default async function ReviewPage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  const { supabase } = await requireAdmin();
  const { saved, error: errorMessage } = await searchParams;

  const [draftsRes, postedRes, settings, discrepancies] = await Promise.all([
    supabase
      .from("invoices")
      .select("*, lines:invoice_lines!invoice_lines_invoice_id_fkey(*), account:billing_accounts(property:properties(id, name), customer:customers(name), contacts:billing_contacts(id))")
      .eq("status", "draft")
      .order("created_at"),
    supabase.from("invoices").select("id, account_id, invoice_number, service_month, total_cents, origin, kind, service_category, lines:invoice_lines!invoice_lines_invoice_id_fkey(*)").in("status", ["approved", "sent", "partially_paid", "paid"]),
    supabase.from("app_settings").select("next_invoice_number").maybeSingle(),
    supabase.from("source_discrepancies").select("property_id").is("resolved_at", null),
  ]);
  const drafts = ((draftsRes.data ?? []) as unknown as Draft[]).sort((a, b) => a.account.property.name.localeCompare(b.account.property.name));
  const posted = (postedRes.data ?? []) as unknown as Posted[];
  const unresolved = new Set((discrepancies.data ?? []).map((d) => d.property_id as string));
  const nextNumber = settings.data?.next_invoice_number as number | null | undefined;

  const today = todayInPhoenix();
  const defaultMonth = today.slice(0, 7);
  const total = drafts.reduce((sum, d) => sum + Number(d.total_cents), 0);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Month end"
        title="Review queue"
        description="Nothing reaches a customer or the ledger until it is approved here. Approved invoices move to the Send page."
        action={<Link href="/invoices/new" className={primaryButton}>Create invoice</Link>}
      />
      {saved && <Notice kind="ok">{saved}</Notice>}
      {errorMessage && <Notice kind="error">{errorMessage}</Notice>}
      {draftsRes.error && <Notice kind="error">Could not load drafts: {draftsRes.error.message}</Notice>}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Generate drafts" description={`Drafts one invoice for every property and service on the schedule that is switched on and owes something that month. Invoices are dated the last day of the service month (${formatDate(monthEnd(`${defaultMonth}-01`))} for ${monthLabel(`${defaultMonth}-01`)}).`}>
          <form action={generateDraftsAction} className="flex flex-wrap gap-2">
            <input type="month" name="month" defaultValue={defaultMonth} aria-label="Service month" className={`${inputClass} max-w-52`} />
            <SubmitButton className={primaryButton}>Generate drafts</SubmitButton>
          </form>
        </Card>
        <Card title="Invoice numbering" description="Numbers are assigned on approval, in order, and never reused.">
          <form action={setNextInvoiceNumber} className="flex flex-wrap gap-2">
            <input name="next_invoice_number" inputMode="numeric" defaultValue={nextNumber ?? ""} placeholder="Next invoice number" aria-label="Next invoice number" className={`${inputClass} max-w-52`} />
            <SubmitButton className={secondaryButton}>Save</SubmitButton>
          </form>
          {nextNumber == null && <p className="mt-3 text-sm text-amber-700">Not set yet. Drafts cannot be approved until it is.</p>}
        </Card>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
        <Eyebrow>
          {drafts.length} draft{drafts.length === 1 ? "" : "s"} · {formatCents(total)}
        </Eyebrow>
        {drafts.length > 1 && (
          <form action={approveAll}>
            <SubmitButton className={primaryButton}>Approve all {drafts.length}</SubmitButton>
          </form>
        )}
      </div>

      {drafts.length === 0 && <Empty>No drafts waiting. Generate drafts for a service month to fill the queue.</Empty>}

      {drafts.map((d) => {
        const previous = posted
          .filter((p) => p.account_id === d.account_id && p.service_month < d.service_month && p.kind !== "ad_hoc" && (p.service_category ?? d.service_category) === d.service_category)
          .sort((a, b) => b.service_month.localeCompare(a.service_month))[0];
        const phases = new Set(d.lines.map((l) => l.contract_phase_id).filter(Boolean));
        const previousPhases = new Set((previous?.lines ?? []).map((l) => l.contract_phase_id).filter(Boolean));
        const flags: string[] = [];
        const oneOff = d.kind === "ad_hoc";
        if (!previous && !oneOff) flags.push("First invoice for this service");
        if (phases.size > 1 || (previous && previous.origin === "app" && [...phases].some((p) => !previousPhases.has(p)))) flags.push("Phase change this month");
        if (previous && Number(previous.total_cents) !== Number(d.total_cents)) flags.push("Amount differs from last month");
        if (d.account.contacts.length === 0) flags.push("Missing billing contact");
        if (unresolved.has(d.account.property.id)) flags.push("Unresolved source discrepancy");
        const lines = [...d.lines].sort((a, b) => a.sort_order - b.sort_order);

        return (
          <section key={d.id} className="overflow-hidden rounded-3xl border border-line bg-white shadow-[0_1px_2px_rgb(16_24_40/0.04)]">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line p-5 sm:p-7">
              <div>
                <Eyebrow>
                  <span className="mr-2 inline-block size-2 rounded-full align-middle" style={{ backgroundColor: SERVICES[isServiceCategory(d.service_category) ? d.service_category : "other"].hex }} aria-hidden />
                  {SERVICES[isServiceCategory(d.service_category) ? d.service_category : "other"].label} · {oneOff ? `one-off, dated ${formatDate(d.invoice_date)}` : monthLabel(d.service_month)} · due {formatDate(d.due_date)}
                </Eyebrow>
                <h2 className="mt-1.5 text-xl font-semibold tracking-tight text-ink">
                  <Link href={`/accounts/${d.account_id}`} className="hover:underline">{d.account.property.name}</Link>
                </h2>
                <p className="text-sm text-mute">{d.account.customer.name}</p>
                {flags.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {flags.map((f) => (
                      <span key={f} className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800 ring-1 ring-amber-200">{f}</span>
                    ))}
                  </div>
                )}
              </div>
              <p className="text-3xl font-semibold tabular-nums tracking-tight text-ink">{formatCents(Number(d.total_cents))}</p>
            </div>

            <div className="grid gap-px bg-line lg:grid-cols-2">
              <div className="bg-white p-5 sm:p-7">
                <Eyebrow>This draft</Eyebrow>
                <div className="mt-3 space-y-2">
                  {lines.map((l) => (
                    <form key={l.id} action={updateDraftLine} className="grid gap-2 sm:grid-cols-[1fr_7.5rem_auto]">
                      <input type="hidden" name="invoice_id" value={d.id} />
                      <input type="hidden" name="line_id" value={l.id} />
                      <input name="description" defaultValue={l.description} aria-label="Line description" className={inputClass} />
                      <input name="amount" inputMode="decimal" defaultValue={centsToInput(Number(l.amount_cents))} aria-label="Line amount in dollars" className={`${inputClass} text-right tabular-nums`} />
                      <SubmitButton className={secondaryButton}>Save</SubmitButton>
                    </form>
                  ))}
                </div>
              </div>
              <div className="bg-slate-50/60 p-5 sm:p-7">
                <Eyebrow>Previous invoice</Eyebrow>
                {previous ? (
                  <div className="mt-3 text-[15px]">
                    <p className="font-medium text-ink">
                      {previous.invoice_number ? `No. ${previous.invoice_number}` : "Invoice"} · {monthLabel(previous.service_month)}
                      {previous.origin === "quickbooks_import" && " · from QuickBooks"}
                    </p>
                    <ul className="mt-2 space-y-1.5 text-slate-600">
                      {[...previous.lines].sort((a, b) => a.sort_order - b.sort_order).map((l) => (
                        <li key={l.id} className="flex justify-between gap-4">
                          <span>{l.description}</span>
                          <span className="tabular-nums">{formatCents(Number(l.amount_cents))}</span>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-3 flex justify-between border-t border-line pt-3 font-semibold text-ink">
                      <span>Total</span>
                      <span className="tabular-nums">{formatCents(Number(previous.total_cents))}</span>
                    </p>
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-mute">{oneOff ? (d.memo ?? "A one-off invoice, so there is nothing to compare it with.") : "None in this app yet. QuickBooks history will appear here once it is imported."}</p>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line p-4 sm:px-7">
              <Link href={`/invoices/${d.id}/pdf`} target="_blank" className={secondaryButton}>Preview PDF</Link>
              <div className="flex gap-2">
                <form action={rejectDraft}>
                  <input type="hidden" name="invoice_id" value={d.id} />
                  <SubmitButton className={dangerButton}>Reject</SubmitButton>
                </form>
                <form action={approveInvoice}>
                  <input type="hidden" name="invoice_id" value={d.id} />
                  <SubmitButton className={primaryButton}>Approve</SubmitButton>
                </form>
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}
