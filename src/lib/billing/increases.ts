import type { SupabaseClient } from "@supabase/supabase-js";
import { formatDate } from "../format";
import { formatCents } from "../money";
import { categoryOfModel, isServiceCategory, type ServiceCategory } from "../services";
import { addDays, monthLabel, type ISODate } from "./dates";
import { escalatePhases, increaseDate, raise, type Decision } from "./escalation";
import { phaseMonthlyCents, type BillingModel, type Phase } from "./invoice-math";

export type IncreaseRow = {
  contractId: string;
  accountId: string;
  propertyName: string;
  clientName: string;
  category: ServiceCategory;
  effective: ISODate;
  bps: number;
  capBps: number | null;
  status: "planned" | "confirmed" | "skipped";
  noticeSentAt: string | null;
  noticeDays: number;
  noticeDue: ISODate;
  units: number | null;
  currentRateCents: number | null; // per unit, when billed per unit
  newRateCents: number | null;
  currentMonthlyCents: number;
  newMonthlyCents: number;
  contacts: { email: string; cc: boolean }[];
};

type ContractRow = {
  id: string; status: string; billing_model: BillingModel; service_category: string | null; start_date: ISODate | null;
  escalation_bps: number | null; escalation_cap_bps: number | null; rate_notice_days: number | null; phases: Phase[]; increases: Decision[] | null;
};
type AccountRow = {
  id: string; property: { name: string }; customer: { name: string };
  contacts: { email: string; delivery: string; is_active: boolean }[]; contracts: ContractRow[];
};

/**
 * Every annual increase that takes effect between `from` and `to`, with the
 * rate before and after and the day its notice is due.
 */
export async function listIncreases(supabase: SupabaseClient, from: ISODate, to: ISODate): Promise<IncreaseRow[]> {
  const { data, error } = await supabase
    .from("billing_accounts")
    .select("id, property:properties(name), customer:customers(name), contacts:billing_contacts(email, delivery, is_active), contracts(*, phases:contract_phases(*), increases:rate_increases(*))")
    .eq("status", "active");
  if (error) throw new Error(error.message);
  const rows: IncreaseRow[] = [];
  for (const account of (data ?? []) as unknown as AccountRow[]) {
    for (const c of account.contracts) {
      if (c.status === "ended" || !c.start_date || c.billing_model === "per_event" || c.billing_model === "as_needed") continue;
      const decisions = c.increases ?? [];
      for (let n = 1; n < 60; n++) {
        const effective = increaseDate(c.start_date, n);
        if (effective > to) break;
        if (effective < from) continue;
        const decision = decisions.find((d) => d.effective_month === effective);
        const bps = decision ? decision.percent_bps : (c.escalation_bps ?? 0);
        if (!decision && bps <= 0) continue;
        // The rate in force just before this increase: earlier confirmed increases already applied.
        const earlier = decisions.filter((d) => d.status === "confirmed" && d.effective_month < effective).map((d) => ({ effective: d.effective_month, bps: d.percent_bps }));
        const before = escalatePhases(c.phases, earlier).filter((p) => p.effective_start <= effective).at(-1);
        if (!before || phaseMonthlyCents(before) === 0) continue;
        const perUnit = before.flat_amount_cents === null;
        const newRate = perUnit ? raise(before.rate_per_unit_cents ?? 0, bps) : null;
        const noticeDays = c.rate_notice_days ?? 90;
        rows.push({
          contractId: c.id,
          accountId: account.id,
          propertyName: account.property.name,
          clientName: account.customer.name,
          category: isServiceCategory(c.service_category) ? c.service_category : categoryOfModel(c.billing_model),
          effective,
          bps,
          capBps: c.escalation_cap_bps,
          status: decision ? decision.status : "planned",
          noticeSentAt: decision?.notice_sent_at ?? null,
          noticeDays,
          noticeDue: addDays(effective, -noticeDays),
          units: perUnit ? before.billable_units : null,
          currentRateCents: perUnit ? before.rate_per_unit_cents : null,
          newRateCents: newRate,
          currentMonthlyCents: phaseMonthlyCents(before),
          newMonthlyCents: perUnit ? (before.billable_units ?? 0) * (newRate ?? 0) : raise(before.flat_amount_cents ?? 0, bps),
          contacts: account.contacts.filter((k) => k.is_active).map((k) => ({ email: k.email.toLowerCase(), cc: k.delivery === "cc" })),
        });
      }
    }
  }
  return rows.sort((a, b) => a.noticeDue.localeCompare(b.noticeDue) || a.propertyName.localeCompare(b.propertyName));
}

const percentText = (bps: number) => `${Math.floor(bps / 100)}${bps % 100 ? `.${String(bps % 100).padStart(2, "0").replace(/0$/, "")}` : ""}`;

/** The notice sent to a property ahead of its annual increase. */
export function noticeEmail(row: IncreaseRow, replyTo: string | null): { subject: string; text: string } {
  const perUnit = row.currentRateCents !== null && row.newRateCents !== null;
  const current = perUnit
    ? `${formatCents(row.currentRateCents!)} per unit (${row.units} units, ${formatCents(row.currentMonthlyCents)} per month)`
    : `${formatCents(row.currentMonthlyCents)} per month`;
  const next = perUnit ? `${formatCents(row.newRateCents!)} per unit (${formatCents(row.newMonthlyCents)} per month)` : `${formatCents(row.newMonthlyCents)} per month`;
  return {
    subject: `Kaizen Waste: annual rate adjustment for ${row.propertyName}, effective ${formatDate(row.effective)}`,
    text: [
      "Hello,",
      "",
      `This is advance notice of the annual rate adjustment for ${row.propertyName}, as provided for in our service agreement.`,
      "",
      `Effective ${formatDate(row.effective)}, the service fee will increase by ${percentText(row.bps)}%.`,
      "",
      `Current rate: ${current}`,
      `New rate: ${next}`,
      "",
      `The new rate will first appear on the invoice for ${monthLabel(row.effective)} service. Nothing changes before then.`,
      "",
      replyTo ? `If you have any questions, reply to this email or write to ${replyTo}.` : "If you have any questions, reply to this email.",
      "",
      "Thank you for your business,",
      "Kaizen Development Team",
    ].join("\n"),
  };
}

export { percentText };
