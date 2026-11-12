"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { todayInPhoenix } from "@/lib/billing/dates";
import { raise } from "@/lib/billing/escalation";
import { listIncreases, noticeEmail } from "@/lib/billing/increases";
import { sendEmail } from "@/lib/email/resend";
import { formatDate } from "@/lib/format";
import { parsePercentToBps } from "@/lib/money";

function back(kind: "saved" | "error", message: string): never {
  revalidatePath("/increases");
  revalidatePath("/schedule");
  revalidatePath("/");
  redirect(`/increases?${kind}=${encodeURIComponent(message)}`);
}

const field = (fd: FormData, key: string) => String(fd.get(key) ?? "").trim();

/**
 * Decides one year's increase: send the notice and confirm it, confirm it
 * because the notice already went out another way, skip it, or undo a decision.
 */
export async function decideIncrease(fd: FormData) {
  const { supabase, user } = await requireAdmin();
  const contractId = field(fd, "contract_id");
  const effective = field(fd, "effective_month");
  const intent = field(fd, "intent");
  const key = { contract_id: contractId, effective_month: effective };

  if (intent === "undo") {
    const { error } = await supabase.from("rate_increases").delete().match(key);
    if (error) back("error", error.message);
    back("saved", "Back to planned. It will not be billed until it is confirmed.");
  }

  const bps = parsePercentToBps(field(fd, "percent"));
  if (bps === null) back("error", "Enter the increase as a percent, for example 3.");

  if (intent === "skip") {
    const { error } = await supabase.from("rate_increases").upsert({ ...key, percent_bps: bps, status: "skipped", notice_sent_at: null }, { onConflict: "contract_id,effective_month" });
    if (error) back("error", error.message);
    back("saved", "Skipped. The rate stays the same for that year.");
  }

  // Work out this increase again at the chosen percent, so the email and the record agree.
  const all = await listIncreases(supabase, effective, effective);
  const base = all.find((r) => r.contractId === contractId && r.effective === effective);
  if (!base) back("error", "That increase could not be found. The contract may have changed.");
  if (base!.capBps !== null && bps! > base!.capBps) back("error", `The contract caps the annual increase at ${base!.capBps / 100}%.`);
  if (bps === 0) back("error", "An increase of 0% is the same as skipping it. Use Skip this year.");

  let sentAt = new Date().toISOString();
  let note = "Marked as sent by hand";
  if (intent === "send") {
    const to = base!.contacts.filter((c) => !c.cc).map((c) => c.email);
    const cc = base!.contacts.filter((c) => c.cc).map((c) => c.email);
    if (to.length === 0) back("error", `${base!.propertyName} has no one in the To line. Add a contact first.`);
    const { data: settings } = await supabase.from("app_settings").select("email_sender, email_reply_to").maybeSingle();
    // The email states the rate at the percent chosen just now.
    const perUnit = base!.currentRateCents !== null;
    const newRate = perUnit ? raise(base!.currentRateCents!, bps!) : null;
    const row = {
      ...base!,
      bps: bps!,
      newRateCents: newRate,
      newMonthlyCents: perUnit ? (base!.units ?? 0) * (newRate ?? 0) : raise(base!.currentMonthlyCents, bps!),
    };
    const standard = noticeEmail(row, settings?.email_reply_to ?? user.email);
    // Wording edited on the page is used as written. If the percent was changed
    // after the message was written, an edited message would state the old
    // rates, so it is refused; an untouched message is simply rewritten.
    const body = String(fd.get("body") ?? "").replace(/\r\n/g, "\n").trim();
    const original = String(fd.get("original_body") ?? "").replace(/\r\n/g, "\n").trim();
    const edited = body !== "" && body !== original;
    const percentChanged = field(fd, "rendered_percent") !== "" && parsePercentToBps(field(fd, "rendered_percent")) !== bps;
    if (edited && percentChanged) {
      back("error", `${base!.propertyName}: the message was edited and still shows the rates for ${field(fd, "rendered_percent")}%. Either set the percent back to ${field(fd, "rendered_percent")}, or reload the page so the message is rewritten for the new percent, then make your edits again.`);
    }
    const email = {
      subject: (percentChanged ? "" : field(fd, "subject")) || standard.subject,
      text: edited ? body : standard.text,
    };
    const sent = await sendEmail({ from: settings?.email_sender ?? "Kaizen Waste <invoices@kaizen-waste.com>", to, cc, replyTo: settings?.email_reply_to ?? user.email, subject: email.subject, text: email.text, attachments: [] });
    if ("error" in sent) back("error", `${base!.propertyName}: ${sent.error}`);
    const sentId = (sent as { id: string }).id;
    await supabase.from("email_sends").insert({ account_id: base!.accountId, kind: "notice", recipients: to, cc, subject: email.subject, sent_at: sentAt, provider_message_id: sentId });
    note = `Notice emailed to ${to.join(", ")}`;
  } else {
    const date = field(fd, "sent_on");
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      if (date > todayInPhoenix()) back("error", "The date the notice was sent cannot be in the future.");
      sentAt = `${date}T19:00:00.000Z`; // noon in Phoenix
      note = `Marked as sent on ${formatDate(date)}`;
    }
  }

  const { error } = await supabase
    .from("rate_increases")
    .upsert({ ...key, percent_bps: bps, status: "confirmed", notice_sent_at: sentAt, notice_note: note }, { onConflict: "contract_id,effective_month" });
  if (error) back("error", error.message);
  back("saved", `${base!.propertyName}: increase confirmed for ${formatDate(effective)}. ${note}.`);
}
