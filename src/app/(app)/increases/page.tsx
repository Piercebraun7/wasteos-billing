import Link from "next/link";
import { PropertyTabs } from "@/components/section-tabs";
import { SubmitButton } from "@/components/submit-button";
import { Empty, inputClass, Notice, PageHeader, primaryButton, secondaryButton } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { addDays, parts, todayInPhoenix } from "@/lib/billing/dates";
import { listIncreases, noticeEmail, percentText } from "@/lib/billing/increases";
import { emailIsConnected } from "@/lib/email/resend";
import { formatDate } from "@/lib/format";
import { formatCents } from "@/lib/money";
import { SERVICES } from "@/lib/services";
import { decideIncrease } from "./actions";

const daysBetween = (a: string, b: string) => {
  const d = (s: string) => {
    const { y, m, d } = parts(s);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((d(b) - d(a)) / 86400000);
};

export default async function IncreasesPage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  const { supabase } = await requireAdmin();
  const { saved, error } = await searchParams;
  const today = todayInPhoenix();
  const [rows, settings] = await Promise.all([
    listIncreases(supabase, "2000-01-01", addDays(today, 366)),
    supabase.from("app_settings").select("email_reply_to").maybeSingle(),
  ]);
  const connected = emailIsConnected();
  // For each contract: the next increase still ahead, and the most recent one that passed without a decision.
  const planned = rows.filter((r) => r.status === "planned");
  const waiting = planned.filter((r) => {
    const same = planned.filter((o) => o.contractId === r.contractId);
    const ahead = same.filter((o) => o.effective > today).map((o) => o.effective).sort()[0];
    const missed = same.filter((o) => o.effective <= today).map((o) => o.effective).sort().at(-1);
    return r.effective === ahead || r.effective === missed;
  });
  const decided = rows.filter((r) => r.status !== "planned" && r.effective >= addDays(today, -400));

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Annual increases"
        title="Properties"
        description="Each contract's rate rises at the start of month 13 and every twelve months after. An increase shows on the schedule as soon as it is planned, but it is only billed once you confirm it here, by sending the notice or marking it sent."
      />
      <PropertyTabs current="increases" />
      {saved && <Notice kind="ok">{saved}</Notice>}
      {error && <Notice kind="error">{error}</Notice>}
      {!connected && <Notice kind="info">Email is not connected yet, so notices cannot be sent from here. You can still mark one as sent if it went out another way.</Notice>}

      {waiting.length === 0 && <Empty>No increases are waiting on you for the next twelve months.</Empty>}
      {waiting.some((r) => r.effective <= today) && (
        <Notice kind="info">
          Some properties are already past month 13 with no increase applied. For each one, either confirm it (it is billed from the next invoice, not backdated) or skip it.
        </Notice>
      )}

      {waiting.map((r) => {
        const untilNotice = daysBetween(today, r.noticeDue);
        const passed = r.effective <= today;
        const pill = passed
          ? { text: "Date passed with no increase: still billing the old rate", tone: "bg-red-50 text-red-700 ring-red-200" }
          : untilNotice < 0
            ? { text: `Notice overdue by ${-untilNotice} day${untilNotice === -1 ? "" : "s"}`, tone: "bg-red-50 text-red-700 ring-red-200" }
            : untilNotice <= 14
              ? { text: untilNotice === 0 ? "Notice due today" : `Notice due in ${untilNotice} day${untilNotice === 1 ? "" : "s"}`, tone: "bg-amber-50 text-amber-800 ring-amber-200" }
              : { text: `Notice due ${formatDate(r.noticeDue)}`, tone: "bg-slate-50 text-slate-600 ring-slate-200" };
        const email = noticeEmail(r, settings.data?.email_reply_to ?? null);
        const to = r.contacts.filter((c) => !c.cc);
        return (
          <section key={r.contractId + r.effective} className="rounded-3xl border border-line bg-white p-5 shadow-[0_1px_2px_rgb(16_24_40/0.04)] sm:p-7">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="flex items-center gap-2 font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-mute">
                  <span className="size-2 rounded-full" style={{ backgroundColor: SERVICES[r.category].hex }} aria-hidden />
                  {SERVICES[r.category].label} · effective {formatDate(r.effective)} · {r.noticeDays} days&apos; notice
                </p>
                <h2 className="mt-1.5 text-xl font-semibold tracking-tight text-ink">
                  <Link href={`/accounts/${r.accountId}`} className="hover:underline">{r.propertyName}</Link>
                </h2>
                <p className="text-sm text-mute">{r.clientName}</p>
              </div>
              <span className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ${pill.tone}`}>{pill.text}</span>
            </div>

            <p className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-2xl font-semibold tabular-nums text-slate-500">{formatCents(r.currentMonthlyCents)}</span>
              <span className="text-mute" aria-hidden>&rarr;</span>
              <span className="font-display text-3xl font-extrabold tabular-nums text-ink">{formatCents(r.newMonthlyCents)}</span>
              <span className="text-sm text-mute">
                per month at {percentText(r.bps)}%
                {r.currentRateCents !== null && ` · ${formatCents(r.currentRateCents)} to ${formatCents(r.newRateCents ?? 0)} per unit`}
                {r.capBps !== null && ` · contract caps it at ${percentText(r.capBps)}%`}
              </span>
            </p>

            <form action={decideIncrease} className="mt-5 flex flex-wrap items-end gap-2 border-t border-line pt-5">
              <input type="hidden" name="contract_id" value={r.contractId} />
              <input type="hidden" name="effective_month" value={r.effective} />
              <label className="block">
                <span className="mb-1.5 block text-[13px] font-medium text-slate-600">Increase %</span>
                <input name="percent" inputMode="decimal" defaultValue={percentText(r.bps)} className={`${inputClass} w-24 text-right tabular-nums`} />
              </label>
              {connected && (
                <button name="intent" value="send" className={primaryButton} disabled={to.length === 0} title={to.length === 0 ? "Add a contact first" : undefined}>
                  Send notice to {to.length === 0 ? "no one yet" : to.map((c) => c.email).join(", ")}
                </button>
              )}
              <label className="block">
                <span className="mb-1.5 block text-[13px] font-medium text-slate-600">Or it was sent on</span>
                <input type="date" name="sent_on" max={today} className={`${inputClass} w-44`} />
              </label>
              <SubmitButton className={secondaryButton}>
                <span>Mark as sent</span>
              </SubmitButton>
              <button name="intent" value="skip" className="h-11 rounded-full px-4 text-sm font-medium text-red-600 hover:bg-red-50">Skip this year</button>

              <details className="mt-2 w-full rounded-2xl border border-line">
                <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-ink">Read or edit the notice email</summary>
                <div className="space-y-3 border-t border-line p-4">
                  <input type="hidden" name="rendered_percent" value={percentText(r.bps)} />
                  <input type="hidden" name="original_body" value={email.text} />
                  <label className="block">
                    <span className="mb-1.5 block text-[13px] font-medium text-slate-600">Subject</span>
                    <input name="subject" defaultValue={email.subject} className={inputClass} />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-[13px] font-medium text-slate-600">Message</span>
                    <textarea name="body" defaultValue={email.text} rows={16} className={`${inputClass} h-auto py-3 leading-relaxed`} />
                  </label>
                  <p className="text-xs text-mute">Changes apply to this notice only. If you change the percent above, the rates in this message are refreshed for you unless you have edited it.</p>
                </div>
              </details>
            </form>

          </section>
        );
      })}

      {decided.length > 0 && (
        <section>
          <h2 className="mb-2 font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-mute">Decided</h2>
          <ul className="divide-y divide-line overflow-hidden rounded-3xl border border-line bg-white shadow-[0_1px_2px_rgb(16_24_40/0.04)]">
            {decided.map((r) => (
              <li key={r.contractId + r.effective} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
                <div className="min-w-0">
                  <p className="truncate font-medium text-ink">{r.propertyName}</p>
                  <p className="text-sm text-mute">
                    {r.status === "skipped"
                      ? `No increase for ${formatDate(r.effective)}`
                      : `${percentText(r.bps)}% from ${formatDate(r.effective)}: ${formatCents(r.currentMonthlyCents)} to ${formatCents(r.newMonthlyCents)} per month${r.noticeSentAt ? ` · notice ${formatDate(r.noticeSentAt)}` : ""}`}
                  </p>
                </div>
                <form action={decideIncrease} className="flex items-center gap-3">
                  <input type="hidden" name="contract_id" value={r.contractId} />
                  <input type="hidden" name="effective_month" value={r.effective} />
                  <input type="hidden" name="intent" value="undo" />
                  <span className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ${r.status === "skipped" ? "bg-slate-50 text-slate-600 ring-slate-200" : "bg-emerald-50 text-emerald-700 ring-emerald-200"}`}>
                    {r.status === "skipped" ? "Skipped" : "Confirmed"}
                  </span>
                  <SubmitButton className="text-sm font-medium text-ink underline-offset-4 hover:underline">Undo</SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
