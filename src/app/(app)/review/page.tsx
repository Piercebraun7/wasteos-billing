import Link from "next/link";
import { SubmitButton } from "@/components/submit-button";
import { dangerButton, Empty, Eyebrow, inputClass, Notice, PageHeader, primaryButton, secondaryButton } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { monthLabel, todayInPhoenix } from "@/lib/billing/dates";
import { formatDate } from "@/lib/format";
import { centsToInput, formatCents } from "@/lib/money";
import { isServiceCategory, SERVICE_ORDER, SERVICES, type ServiceCategory } from "@/lib/services";
import { InvoiceTabs } from "@/components/section-tabs";
import { approveAll, approveInvoice, generateDraftsAction, rejectDraft, updateDraftLine } from "./actions";

type Line = { id: string; description: string; amount_cents: number; quantity: number; unit_price_cents: number; sort_order: number; contract_phase_id: string | null; line_type: string };
type Draft = {
  id: string;
  account_id: string;
  service_month: string;
  invoice_date: string;
  due_date: string;
  total_cents: number;
  kind: string;
  service_category: string | null;
  recurring_invoice_id: string | null;
  memo: string | null;
  lines: Line[];
  account: { property: { id: string; name: string }; customer: { name: string }; contacts: { id: string }[] };
};
type Posted = { id: string; account_id: string; invoice_number: number | null; service_month: string; total_cents: number; origin: string; kind: string; service_category: string | null; lines: Line[] };

export default async function ReviewPage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string; service?: string }> }) {
  const { supabase } = await requireAdmin();
  const { saved, error: errorMessage, service } = await searchParams;
  const view: ServiceCategory | "all" = isServiceCategory(service) ? service : "all";

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
  const allDrafts = ((draftsRes.data ?? []) as unknown as Draft[]).sort((a, b) => a.account.property.name.localeCompare(b.account.property.name));
  const categoryOf = (d: Draft): ServiceCategory => (isServiceCategory(d.service_category) ? d.service_category : "other");
  const drafts = allDrafts.filter((d) => view === "all" || categoryOf(d) === view);
  const posted = (postedRes.data ?? []) as unknown as Posted[];
  const unresolved = new Set((discrepancies.data ?? []).map((d) => d.property_id as string));
  const nextNumber = settings.data?.next_invoice_number as number | null | undefined;

  const today = todayInPhoenix();
  const defaultMonth = today.slice(0, 7);
  const total = drafts.reduce((sum, d) => sum + Number(d.total_cents), 0);

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Step 1 of 2" title="Invoices" description="Check each draft and approve it. Approved invoices move to Send, where they all go out together." />
      <InvoiceTabs supabase={supabase} current="review" />
      {saved && <Notice kind="ok">{saved}</Notice>}
      {errorMessage && <Notice kind="error">{errorMessage}</Notice>}
      {draftsRes.error && <Notice kind="error">Could not load drafts: {draftsRes.error.message}</Notice>}
      {nextNumber == null && (
        <Notice kind="info">
          The starting invoice number is not set, so nothing can be approved yet. Set it in <Link href="/settings" className="font-medium underline">Settings</Link>.
        </Notice>
      )}

      <form action={generateDraftsAction} className="flex flex-wrap items-center gap-2 rounded-3xl border border-line bg-white p-4 sm:px-6">
        <p className="mr-auto text-[15px] text-slate-700">
          <span className="font-semibold text-ink">Monthly invoices.</span> Draft every valet and trash room invoice on the schedule for a month.
        </p>
        <input type="month" name="month" defaultValue={defaultMonth} aria-label="Service month" className={`${inputClass} max-w-48`} />
        <SubmitButton className={primaryButton}>Draft the month</SubmitButton>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
        <div className="flex flex-wrap gap-1 rounded-full border border-line bg-white p-1">
          {(["all", ...SERVICE_ORDER] as const).map((key) => {
            const count = key === "all" ? allDrafts.length : allDrafts.filter((d) => categoryOf(d) === key).length;
            if (key === "other" && count === 0) return null;
            return (
              <Link
                key={key}
                href={key === "all" ? "/review" : `/review?service=${key}`}
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
        <div className="flex items-center gap-4">
          <Eyebrow>{formatCents(total)}</Eyebrow>
          {drafts.length > 1 && (
            <form action={approveAll}>
              <input type="hidden" name="service" value={view} />
              <SubmitButton className={primaryButton}>
                Approve {drafts.length} {view === "all" ? "" : `${SERVICES[view].short.toLowerCase()} `}drafts
              </SubmitButton>
            </form>
          )}
        </div>
      </div>

      {drafts.length === 0 && <Empty>Nothing to review. Draft the month above, enter bulk pickups, or create a one-off invoice.</Empty>}

      {drafts.map((d) => {
        const previous = posted
          .filter((p) => p.account_id === d.account_id && p.service_month < d.service_month && p.kind !== "ad_hoc" && (p.service_category ?? d.service_category) === d.service_category)
          .sort((a, b) => b.service_month.localeCompare(a.service_month))[0];
        const phases = new Set(d.lines.map((l) => l.contract_phase_id).filter(Boolean));
        const previousPhases = new Set((previous?.lines ?? []).map((l) => l.contract_phase_id).filter(Boolean));
        const flags: string[] = [];
        const oneOff = d.kind === "ad_hoc";
        if (!previous && !oneOff) flags.push("First invoice for this service");
        if (phases.size > 1 || (previous && previous.origin === "app" && [...phases].some((p) => !previousPhases.has(p)))) flags.push("Rate change this month");
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
                  {SERVICES[isServiceCategory(d.service_category) ? d.service_category : "other"].label} · {oneOff ? `${d.recurring_invoice_id ? "recurring" : "one-off"}, dated ${formatDate(d.invoice_date)}` : monthLabel(d.service_month)} · due {formatDate(d.due_date)}
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
                    <form key={l.id} action={updateDraftLine} className={`grid gap-2 ${l.line_type === "per_event" ? "sm:grid-cols-[1fr_4.5rem_6.5rem_auto]" : "sm:grid-cols-[1fr_7.5rem_auto]"}`}>
                      <input type="hidden" name="invoice_id" value={d.id} />
                      <input type="hidden" name="line_id" value={l.id} />
                      <input type="hidden" name="return_service" value={view} />
                      <input name="description" defaultValue={l.description} aria-label="Line description" className={inputClass} />
                      {l.line_type === "per_event" ? (
                        <>
                          <input name="quantity" inputMode="decimal" defaultValue={Number(l.quantity)} aria-label="Quantity" title="Quantity" className={`${inputClass} text-right tabular-nums`} />
                          <input name="rate" inputMode="decimal" defaultValue={centsToInput(Number(l.unit_price_cents))} aria-label="Rate in dollars" title="Rate" className={`${inputClass} text-right tabular-nums`} />
                        </>
                      ) : (
                        <input name="amount" inputMode="decimal" defaultValue={centsToInput(Number(l.amount_cents))} aria-label="Line amount in dollars" className={`${inputClass} text-right tabular-nums`} />
                      )}
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
                  <p className="mt-3 text-sm text-mute">{oneOff ? (d.memo ?? (d.recurring_invoice_id ? "Made from a recurring invoice. Change the quantity here if this month was different." : "A one-off invoice, so there is nothing to compare it with.")) : "None in this app yet. QuickBooks history will appear here once it is imported."}</p>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line p-4 sm:px-7">
              <Link href={`/invoices/${d.id}/pdf`} target="_blank" className={secondaryButton}>Preview PDF</Link>
              <div className="flex gap-2">
                <form action={rejectDraft}>
                  <input type="hidden" name="invoice_id" value={d.id} />
                  <input type="hidden" name="return_service" value={view} />
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
