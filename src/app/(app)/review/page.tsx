import { describeTwin, lookAlikes, possibleDuplicates } from "@/lib/billing/duplicates";
import { resolveOptions, type BlockKey } from "@/lib/pdf/template";
import { DraftPreview } from "./draft-preview";
import Link from "next/link";
import { SubmitButton } from "@/components/submit-button";
import { dangerButton, Empty, Eyebrow, inputClass, Notice, PageHeader, primaryButton, secondaryButton } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { monthLabel, todayInPhoenix } from "@/lib/billing/dates";
import { formatDate } from "@/lib/format";
import { centsToInput, formatCents } from "@/lib/money";
import { isServiceCategory, SERVICE_ORDER, SERVICES, type ServiceCategory } from "@/lib/services";
import { InvoiceTabs } from "@/components/section-tabs";
import { rejectAll, approveAll, approveInvoice, generateDraftsAction, rejectDraft, updateDraftLine } from "./actions";

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
  late_fee_for: string | null;
  layout_options: Partial<Record<BlockKey, boolean>> | null;
  memo: string | null;
  lines: Line[];
  account: { invoice_template_id: string | null; property: { id: string; name: string }; customer: { name: string }; contacts: { id: string }[] };
};
type Posted = { id: string; account_id: string; late_fee_for: string | null; invoice_number: number | null; status: string; invoice_date: string; service_month: string; total_cents: number; origin: string; kind: string; service_category: string | null; lines: Line[] };

export default async function ReviewPage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string; service?: string }> }) {
  const { supabase } = await requireAdmin();
  const { saved, error: errorMessage, service } = await searchParams;
  const view: ServiceCategory | "all" = isServiceCategory(service) ? service : "all";

  const [draftsRes, postedRes, settings, discrepancies, active, templatesRes] = await Promise.all([
    supabase
      .from("invoices")
      .select("*, lines:invoice_lines!invoice_lines_invoice_id_fkey(*), account:billing_accounts(invoice_template_id, property:properties(id, name), customer:customers(name), contacts:billing_contacts(id))")
      .eq("status", "draft")
      .order("created_at"),
    supabase.from("invoices").select("id, account_id, late_fee_for, invoice_number, status, invoice_date, service_month, total_cents, origin, kind, service_category, lines:invoice_lines!invoice_lines_invoice_id_fkey(*)").in("status", ["approved", "sent", "partially_paid", "paid"]),
    supabase.from("app_settings").select("next_invoice_number").maybeSingle(),
    supabase.from("source_discrepancies").select("property_id").is("resolved_at", null),
    supabase.from("billing_accounts").select("id, property:properties(name)").eq("status", "active"),
    supabase.from("invoice_templates").select("id, is_default, options"),
  ]);
  const templateRows = (templatesRes.data ?? []) as { id: string; is_default: boolean; options: unknown }[];
  const templateFor = (templateId: string | null) => resolveOptions((templateRows.find((t) => t.id === templateId) ?? templateRows.find((t) => t.is_default))?.options);
  const properties = ((active.data ?? []) as unknown as { id: string; property: { name: string } }[]).map((a) => ({ id: a.id, name: a.property.name })).sort((a, b) => a.name.localeCompare(b.name));
  const allDrafts = ((draftsRes.data ?? []) as unknown as Draft[]).sort((a, b) => a.account.property.name.localeCompare(b.account.property.name));
  const categoryOf = (d: Draft): ServiceCategory => (isServiceCategory(d.service_category) ? d.service_category : "other");
  const drafts = allDrafts.filter((d) => view === "all" || categoryOf(d) === view);
  const posted = (postedRes.data ?? []) as unknown as Posted[];
  const unresolved = new Set((discrepancies.data ?? []).map((d) => d.property_id as string));
  const nextNumber = settings.data?.next_invoice_number as number | null | undefined;

  // Anything that looks like the same bill made twice, across drafts and invoices already issued.
  const everyInvoice = [
    ...allDrafts.map((d) => ({ id: d.id, account_id: d.account_id, invoice_number: null, status: "draft", origin: "app", service_category: d.service_category, service_month: d.service_month, invoice_date: d.invoice_date, total_cents: Number(d.total_cents), late_fee_for: d.late_fee_for })),
    ...posted.map((p) => ({ ...p, total_cents: Number(p.total_cents) })),
  ];
  const twins = possibleDuplicates(everyInvoice);
  const similar = lookAlikes(everyInvoice);
  const flaggedDrafts = allDrafts.filter((d) => twins.has(d.id));

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

      {flaggedDrafts.length > 0 && (
        <div role="alert" className="rounded-3xl border-2 border-red-300 bg-red-50 p-5 sm:px-7">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-red-700">Duplicates</p>
          <p className="mt-1 text-[15px] font-semibold text-red-900">
            {flaggedDrafts.length} draft{flaggedDrafts.length === 1 ? " matches" : "s match"} another bill: same property, same date, same amount. Only one of each can be approved and sent.
          </p>
          <ul className="mt-2 space-y-1 text-sm text-red-900">
            {flaggedDrafts.map((d) => (
              <li key={d.id}>
                <a href={`#draft-${d.id}`} className="font-medium underline">{d.account.property.name}</a>, {formatCents(Number(d.total_cents))}: matches {[...new Set(twins.get(d.id)!.map(describeTwin))].join(" and ")}.
              </li>
            ))}
          </ul>
          <p className="mt-2 text-sm text-red-800">Approving one stops its twin from being approved. Reject the extra one to clear it from the queue.</p>
        </div>
      )}

      <form action={generateDraftsAction} className="flex flex-wrap items-center gap-2 rounded-3xl border border-line bg-white p-4 sm:px-6">
        <p className="mr-auto text-[15px] text-slate-700">
          <span className="font-semibold text-ink">Monthly invoices.</span> Draft every valet and trash room invoice on the schedule for a month.
        </p>
        <input type="month" name="month" defaultValue={defaultMonth} aria-label="Service month" className={`${inputClass} max-w-48`} />
        <SubmitButton className={primaryButton}>Draft the month</SubmitButton>
        <details className="w-full">
          <summary className="cursor-pointer pt-2 text-sm font-medium text-ink underline underline-offset-4">Or draft only some properties</summary>
          <div className="mt-3 grid gap-x-6 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3">
            {properties.map((p) => (
              <label key={p.id} className="flex items-center gap-2 text-[15px] text-slate-700">
                <input type="checkbox" name="account" value={p.id} className="size-4" />
                <span className="truncate">{p.name}</span>
              </label>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button type="submit" name="intent" value="selected" className={secondaryButton}>Draft the ticked properties</button>
            <span className="text-sm text-mute">Drafts their monthly invoice for the month above. Anything already drafted or invoiced for that month is left alone.</span>
          </div>
        </details>
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
          {drafts.length > 0 && (
            <details className="relative">
              <summary className={`${dangerButton} cursor-pointer list-none`}>Remove all</summary>
              <form action={rejectAll} className="absolute right-0 top-full z-20 mt-2 w-80 rounded-2xl border border-line bg-white p-4 shadow-xl">
                <input type="hidden" name="service" value={view} />
                <p className="text-sm text-slate-700">
                  Remove {drafts.length === 1 ? "this draft" : `all ${drafts.length} ${view === "all" ? "" : `${SERVICES[view].short.toLowerCase()} `}drafts`}? Nothing approved or sent is touched, and monthly drafts can be made again. A late fee removed this way is waived.
                </p>
                <SubmitButton className={`${dangerButton} mt-3 border border-red-200`}>Yes, remove {drafts.length === 1 ? "it" : `all ${drafts.length}`}</SubmitButton>
              </form>
            </details>
          )}
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
        if (d.late_fee_for) flags.push("Late fee: reject it to waive the fee");
        const oneOff = d.kind === "ad_hoc";
        if (!previous && !oneOff) flags.push("First invoice for this service");
        if (phases.size > 1 || (previous && previous.origin === "app" && [...phases].some((p) => !previousPhases.has(p)))) flags.push("Rate change this month");
        if (previous && Number(previous.total_cents) !== Number(d.total_cents)) flags.push("Amount differs from last month");
        const twin = twins.get(d.id);
        const alike = similar.get(d.id);
        if (alike) flags.push(`Same amount as ${[...new Set(alike.map(describeTwin))].join(" and ")} this month, on another day`);
        if (d.account.contacts.length === 0) flags.push("Missing billing contact");
        if (unresolved.has(d.account.property.id)) flags.push("Unresolved source discrepancy");
        const lines = [...d.lines].sort((a, b) => a.sort_order - b.sort_order);

        return (
          <section key={d.id} id={`draft-${d.id}`} className={`scroll-mt-6 overflow-hidden rounded-3xl border bg-white shadow-[0_1px_2px_rgb(16_24_40/0.04)] ${twin ? "border-2 border-red-300" : "border-line"}`}>
            {twin && (
              <p className="bg-red-600 px-5 py-2 text-sm font-semibold text-white sm:px-7">
                Duplicate of {[...new Set(twin.map(describeTwin))].join(" and ")}. Only one of them can be approved.
              </p>
            )}
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
                {previous && (
                  <p className="mt-1 text-sm text-slate-600">
                    Last invoice: {previous.invoice_number ? `No. ${previous.invoice_number}` : "invoice"}, {monthLabel(previous.service_month)}, {formatCents(Number(previous.total_cents))}
                    {previous.origin === "quickbooks_import" ? " (from QuickBooks)" : ""}
                    {Number(previous.total_cents) === Number(d.total_cents) ? <span className="text-emerald-700"> · same amount</span> : <span className="font-medium text-amber-700"> · {Number(d.total_cents) > Number(previous.total_cents) ? "up" : "down"} {formatCents(Math.abs(Number(d.total_cents) - Number(previous.total_cents)))}</span>}
                  </p>
                )}
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

            <div className="p-5 sm:p-7">
              <div className="hidden grid-cols-[minmax(0,1fr)_5rem_7rem_7rem_auto] gap-3 pb-2 font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-mute md:grid">
                <span>Service</span><span className="text-right">Qty</span><span className="text-right">Rate</span><span className="text-right">Amount</span><span className="w-16" />
              </div>
              <div className="divide-y divide-line">
                {lines.map((l) => {
                  // A line whose quantity times rate equals its amount is changed by quantity and rate. A prorated or flat line is changed by its amount.
                  const priced = Number(l.quantity) > 0 && Math.round(Number(l.quantity) * Number(l.unit_price_cents)) === Number(l.amount_cents);
                  return (
                    <form key={l.id} action={updateDraftLine} className="grid items-start gap-3 py-3 md:grid-cols-[minmax(0,1fr)_5rem_7rem_7rem_auto]">
                      <input type="hidden" name="invoice_id" value={d.id} />
                      <input type="hidden" name="line_id" value={l.id} />
                      <input type="hidden" name="return_service" value={view} />
                      <textarea name="description" defaultValue={l.description} rows={Math.min(4, Math.max(1, Math.ceil(l.description.length / 70)))} aria-label="Service description" className={`${inputClass} h-auto resize-y py-2.5 leading-snug`} />
                      {priced ? (
                        <>
                          <input name="quantity" inputMode="decimal" defaultValue={Number(l.quantity)} aria-label="Quantity" className={`${inputClass} text-right tabular-nums`} />
                          <input name="rate" inputMode="decimal" defaultValue={centsToInput(Number(l.unit_price_cents))} aria-label="Rate in dollars" className={`${inputClass} text-right tabular-nums`} />
                          <p className="flex h-11 items-center justify-end text-[15px] font-semibold tabular-nums text-ink">{formatCents(Number(l.amount_cents))}</p>
                        </>
                      ) : (
                        <>
                          <p className="flex h-11 items-center justify-end text-[15px] tabular-nums text-mute">{Number(l.quantity)}</p>
                          <p className="flex h-11 items-center justify-end text-[15px] tabular-nums text-mute">{formatCents(Number(l.unit_price_cents))}</p>
                          <input name="amount" inputMode="decimal" defaultValue={centsToInput(Number(l.amount_cents))} aria-label="Line amount in dollars" className={`${inputClass} text-right tabular-nums`} />
                        </>
                      )}
                      <SubmitButton className={secondaryButton}>Save</SubmitButton>
                    </form>
                  );
                })}
              </div>
              <p className="flex items-center justify-end gap-4 border-t border-line pt-3">
                <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-mute">Invoice total</span>
                <span className="text-xl font-semibold tabular-nums text-ink">{formatCents(Number(d.total_cents))}</span>
              </p>
              {d.memo && <p className="mt-2 text-sm text-mute">Message on the invoice: {d.memo}</p>}
            </div>

            <DraftPreview key={`${d.id}-${JSON.stringify(d.layout_options ?? {})}`} invoiceId={d.id} template={templateFor(d.account.invoice_template_id)} saved={d.layout_options ?? {}} scheduled={!oneOff} />

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line p-4 sm:px-7">
              <div className="flex flex-wrap gap-2">
                <Link href={`/invoices/${d.id}`} className={secondaryButton}>Open to edit or add lines</Link>
              </div>
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
