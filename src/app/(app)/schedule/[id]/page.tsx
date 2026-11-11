import Link from "next/link";
import { notFound } from "next/navigation";
import { SubmitButton } from "@/components/submit-button";
import { Card, Eyebrow, Field, inputClass, Notice, primaryButton, secondaryButton } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { monthLabel, monthStart, todayInPhoenix } from "@/lib/billing/dates";
import { phaseMonthlyCents, type BillingModel, type Phase } from "@/lib/billing/invoice-math";
import { nextMonth, scheduleCell, type ScheduleCell } from "@/lib/billing/schedule";
import type { ScrapedTerms } from "@/lib/contracts/parse";
import { flatPhase, rampPhases, termEnd, type Alignment, type NewPhase } from "@/lib/contracts/ramp";
import { BILLING_MODELS, formatDate, usesPhases } from "@/lib/format";
import { centsToInput, formatCents, parseDollarsToCents } from "@/lib/money";
import { applySchedule, uploadContract } from "../actions";

type Contract = {
  id: string;
  status: string;
  billing_model: BillingModel;
  start_date: string | null;
  end_date: string | null;
  created_at: string;
  contract_file_name: string | null;
  scraped_terms: ScrapedTerms | null;
  phases: Phase[];
};

const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export default async function LaunchPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; error?: string; start?: string; align?: string; units?: string; rate?: string; monthly?: string }>;
}) {
  const { supabase } = await requireAdmin();
  const { id } = await params;
  const query = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const { data, error } = await supabase
    .from("billing_accounts")
    .select("id, go_live_service_month, property:properties(name, unit_count), customer:customers(name), contracts(*, phases:contract_phases(*))")
    .eq("id", id)
    .maybeSingle();
  if (error) return <Notice kind="error">Could not load this property: {error.message}</Notice>;
  if (!data) notFound();
  const account = data as unknown as {
    id: string;
    go_live_service_month: string | null;
    property: { name: string; unit_count: number | null };
    customer: { name: string };
    contracts: Contract[];
  };
  const byAge = [...account.contracts].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const contract = byAge.find((c) => usesPhases(c.billing_model)) ?? byAge[0];
  if (!contract) notFound();
  const terms = contract.scraped_terms;
  const phases = [...contract.phases].filter((p) => !p.superseded_at).sort((a, b) => a.effective_start.localeCompare(b.effective_start));
  const current = phases.at(-1);
  const perUnit = contract.billing_model === "per_unit_valet";

  // The next 24 months of this property's schedule, starting where its billing starts.
  const today = todayInPhoenix();
  const firstMonth = monthStart(contract.start_date ?? phases[0]?.effective_start ?? today);
  const strip: ScheduleCell[] = [];
  for (let month = firstMonth, i = 0; i < 24; i++, month = nextMonth(month)) {
    strip.push(scheduleCell({ model: contract.billing_model, phases, month, contractStart: contract.start_date }));
  }
  const peak = Math.max(1, ...strip.map((c) => c.amountCents ?? 0));

  // Proposed schedule, from the contract plus whatever is typed into the form.
  const start = /^\d{4}-\d{2}-\d{2}$/.test(query.start ?? "") ? query.start! : (contract.start_date ?? terms?.commencement ?? "");
  const align: Alignment = query.align === "anniversary" ? "anniversary" : "calendar";
  const units = /^\d+$/.test(query.units ?? "") ? Number(query.units) : (terms?.unitCount ?? account.property.unit_count ?? 0);
  const rate = parseDollarsToCents(query.rate ?? "") ?? terms?.ratePerUnitCents ?? current?.rate_per_unit_cents ?? 0;
  const monthly = parseDollarsToCents(query.monthly ?? "") ?? current?.flat_amount_cents ?? terms?.monthlyFeeCents ?? 0;
  let proposed: NewPhase[] = [];
  if (terms && start) {
    if (perUnit && units > 0) proposed = rampPhases({ steps: terms.ramp, start, align, fullUnits: units, rateCents: rate });
    else if (!perUnit && usesPhases(contract.billing_model)) proposed = flatPhase(start, monthly);
  }

  const differs = (a: unknown, b: unknown) => a != null && b != null && a !== b;
  const compare: { label: string; contract: string; app: string; flag: boolean }[] = terms
    ? [
        { label: "Start of service", contract: terms.commencement ? formatDate(terms.commencement) : "Not found", app: contract.start_date ? formatDate(contract.start_date) : "Not set", flag: differs(terms.commencement, contract.start_date) },
        { label: "Term length", contract: terms.termYears ? `${terms.termYears} year${terms.termYears === 1 ? "" : "s"}` : "Not found", app: contract.end_date ? `Ends ${formatDate(contract.end_date)}` : "No end date set", flag: false },
        { label: "Unit count", contract: terms.unitCount != null ? String(terms.unitCount) : "Not applicable", app: account.property.unit_count != null ? String(account.property.unit_count) : "Not set", flag: differs(terms.unitCount, account.property.unit_count) },
        { label: "Rate per unit", contract: terms.ratePerUnitCents != null ? formatCents(terms.ratePerUnitCents) : "Not applicable", app: current?.rate_per_unit_cents != null ? formatCents(current.rate_per_unit_cents) : "Not applicable", flag: differs(terms.ratePerUnitCents, current?.rate_per_unit_cents) },
        { label: "Full monthly fee, before tax", contract: terms.monthlyFeeCents != null ? formatCents(terms.monthlyFeeCents) : "Not found", app: current ? formatCents(phaseMonthlyCents(current)) : "No phases yet", flag: differs(terms.monthlyFeeCents, current ? phaseMonthlyCents(current) : null) },
        { label: "Rate increases", contract: terms.ramp.length ? `Lease-up schedule, ${terms.ramp.length} steps` : "None listed", app: `${phases.length} phase${phases.length === 1 ? "" : "s"}`, flag: false },
        { label: "Payment terms", contract: terms.paymentDays ? `${terms.paymentDays} days` : "Not found", app: "Net 30 (your standing rule)", flag: false },
        { label: "Late fee", contract: terms.lateFeePercent ? `${terms.lateFeePercent}%` : "Not found", app: "3% monthly (your standing rule)", flag: false },
        { label: "Sales tax listed", contract: terms.taxPercent ? `${terms.taxPercent}%` : "None", app: "Not charged", flag: false },
      ]
    : [];

  return (
    <div className="space-y-5">
      <Link href="/schedule" className="inline-flex items-center gap-1.5 text-sm font-medium text-mute transition hover:text-ink">
        <span aria-hidden>&larr;</span> Schedule of billing
      </Link>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Eyebrow>{account.customer.name} · {BILLING_MODELS[contract.billing_model]}</Eyebrow>
          <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">{account.property.name}</h1>
          <p className="mt-1 text-[15px] text-mute">
            {contract.status === "active" ? "Active for billing" : "Not active for billing yet"}
            {account.go_live_service_month && ` · goes live with ${monthLabel(account.go_live_service_month)} service`}
          </p>
        </div>
        <Link href={`/accounts/${account.id}`} className={secondaryButton}>Open property page</Link>
      </div>

      {query.saved && <Notice kind="ok">{query.saved}</Notice>}
      {query.error && <Notice kind="error">{query.error}</Notice>}

      <Card title="Schedule" description="The next 24 months from the start of service, as the phases stand now.">
        {phases.length === 0 ? (
          <p className="text-sm text-mute">No phases yet. Upload the contract below, or add phases on the property page.</p>
        ) : (
          <div className="overflow-x-auto">
            <div className="flex min-w-[900px] items-end gap-1.5">
              {strip.map((cell) => {
                const { m, y } = { m: Number(cell.month.slice(5, 7)), y: cell.month.slice(2, 4) };
                const height = cell.amountCents ? 10 + Math.round(86 * (cell.amountCents / peak)) : 4;
                return (
                  <div key={cell.month} className="flex flex-1 flex-col items-center gap-1.5">
                    <span className="text-[10px] font-semibold tabular-nums text-ink">
                      {cell.amountCents === null ? "" : cell.free ? "Free" : formatCents(cell.amountCents).slice(0, -3)}
                    </span>
                    <div
                      className={`w-full rounded-md ${cell.amountCents === null ? "bg-slate-100" : cell.free ? "bg-ice ring-1 ring-sky-200" : "bg-tomato"} ${cell.partial ? "opacity-60" : ""}`}
                      style={{ height }}
                      title={`${monthLabel(cell.month)}: ${cell.amountCents === null ? "nothing scheduled" : formatCents(cell.amountCents)}`}
                    />
                    <span className={`font-mono text-[10px] uppercase tracking-wider ${m === 1 ? "font-semibold text-ink" : "text-mute"}`}>
                      {SHORT[m - 1]}{m === 1 || cell === strip[0] ? ` ${y}` : ""}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Card>

      <Card title="Signed contract" description="Upload the signed PDF. It is stored privately, and the app reads its rate, unit count, term, and rate schedule for you to check. Nothing changes until you build the schedule below.">
        <form action={uploadContract} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="account_id" value={account.id} />
          <input type="hidden" name="contract_id" value={contract.id} />
          <input type="file" name="file" accept="application/pdf,.pdf" required aria-label="Signed contract PDF" className="max-w-xs text-sm text-slate-600 file:mr-3 file:h-11 file:cursor-pointer file:rounded-full file:border file:border-line file:bg-white file:px-4 file:text-sm file:font-medium file:text-ink" />
          <SubmitButton className={primaryButton}>{contract.contract_file_name ? "Replace contract" : "Upload and read"}</SubmitButton>
          {contract.contract_file_name && (
            <a href={`/schedule/${account.id}/contract`} className={secondaryButton}>Download {contract.contract_file_name}</a>
          )}
        </form>

        {terms && terms.kind !== "unknown" && (
          <div className="mt-6 overflow-hidden rounded-2xl border border-line">
            <div className="grid grid-cols-[1.2fr_1fr_1fr] bg-slate-50 px-4 py-2.5 font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-mute">
              <span>Term</span><span>The contract says</span><span>The app has</span>
            </div>
            {compare.map((c) => (
              <div key={c.label} className="grid grid-cols-[1.2fr_1fr_1fr] border-t border-line px-4 py-2.5 text-[15px]">
                <span className="text-mute">{c.label}</span>
                <span className="font-medium text-ink">{c.contract}</span>
                <span className={c.flag ? "font-medium text-red-600" : "text-slate-600"}>
                  {c.app}{c.flag && " *"}
                </span>
              </div>
            ))}
          </div>
        )}
        {compare.some((c) => c.flag) && (
          <p className="mt-3 text-sm text-mute">
            <span className="font-semibold text-red-600">*</span> Differs from the contract. Nothing is changed for you: decide which is right.
          </p>
        )}
      </Card>

      {terms && terms.kind !== "unknown" && usesPhases(contract.billing_model) && (
        <Card title="Build the schedule from the contract" description="Adjust the inputs and click Preview. When the table below is right, apply it. This replaces the property's current phases, and is refused if any of them has already been invoiced.">
          <form className="grid gap-4 sm:grid-cols-4">
            <Field label="Service start date" hint="Notion is the source for start dates.">
              <input type="date" name="start" defaultValue={start} className={inputClass} />
            </Field>
            {perUnit ? (
              <>
                <Field label="Full unit count">
                  <input name="units" inputMode="numeric" defaultValue={units || ""} className={inputClass} />
                </Field>
                <Field label="Rate per unit">
                  <input name="rate" inputMode="decimal" defaultValue={centsToInput(rate)} className={inputClass} />
                </Field>
                <Field label="Lease-up months follow" hint="Calendar: month 2 starts on the 1st of the next month.">
                  <select name="align" defaultValue={align} className={inputClass}>
                    <option value="calendar">Calendar months</option>
                    <option value="anniversary">The service start day</option>
                  </select>
                </Field>
              </>
            ) : (
              <Field label="Monthly amount">
                <input name="monthly" inputMode="decimal" defaultValue={centsToInput(monthly)} className={inputClass} />
              </Field>
            )}
            <div className="sm:col-span-4">
              <button className={secondaryButton}>Preview</button>
            </div>
          </form>

          {proposed.length > 0 ? (
            <>
              <div className="mt-6 overflow-hidden rounded-2xl border border-line">
                <div className="grid grid-cols-[1.4fr_1fr_0.7fr_0.8fr_1fr] bg-slate-50 px-4 py-2.5 font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-mute">
                  <span>Phase</span><span>Starts</span><span className="text-right">Units</span><span className="text-right">Rate</span><span className="text-right">Per month</span>
                </div>
                {proposed.map((p) => (
                  <div key={p.effective_start + p.label} className="grid grid-cols-[1.4fr_1fr_0.7fr_0.8fr_1fr] border-t border-line px-4 py-2.5 text-[15px]">
                    <span className="font-medium text-ink">{p.label}</span>
                    <span className="text-slate-600">{formatDate(p.effective_start)}</span>
                    <span className="text-right tabular-nums text-slate-600">{p.billable_units ?? ""}</span>
                    <span className="text-right tabular-nums text-slate-600">{p.rate_per_unit_cents != null ? formatCents(p.rate_per_unit_cents) : ""}</span>
                    <span className="text-right font-semibold tabular-nums text-ink">{formatCents(phaseMonthlyCents({ ...p, id: "" }))}</span>
                  </div>
                ))}
              </div>
              {terms.termYears && start && (
                <p className="mt-3 text-sm text-mute">The contract end date will be set to {formatDate(termEnd(start, terms.termYears))} ({terms.termYears} year term from the start date).</p>
              )}
              <form action={applySchedule} className="mt-4">
                <input type="hidden" name="account_id" value={account.id} />
                <input type="hidden" name="contract_id" value={contract.id} />
                <input type="hidden" name="start" value={start} />
                <input type="hidden" name="align" value={align} />
                <input type="hidden" name="units" value={units} />
                <input type="hidden" name="rate" value={centsToInput(rate)} />
                <input type="hidden" name="monthly" value={centsToInput(monthly)} />
                <SubmitButton className={primaryButton}>Apply this schedule</SubmitButton>
              </form>
            </>
          ) : (
            <p className="mt-4 text-sm text-mute">Enter a start date{perUnit ? " and unit count" : ""}, then click Preview.</p>
          )}
        </Card>
      )}
    </div>
  );
}
