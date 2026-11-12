"use server";

import { renderToBuffer } from "@react-pdf/renderer";
import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { invoiceEmail } from "@/lib/email/invoice-email";
import { sendEmail, type Attachment } from "@/lib/email/resend";
import { buildInvoiceDocument, pdfPath } from "@/lib/pdf/build";
import { isServiceCategory } from "@/lib/services";
import { InvoicePdf } from "@/lib/pdf/invoice-pdf";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function back(kind: "saved" | "error", message: string, service = ""): never {
  revalidatePath("/send");
  revalidatePath("/review");
  revalidatePath("/accounts");
  redirect(`/send?${isServiceCategory(service) ? `service=${service}&` : ""}${kind}=${encodeURIComponent(message)}`);
}

type Choice = { to: string[]; copySelf: boolean; copyJr: boolean };

/**
 * Sends every approved, unsent invoice for one property in a single email,
 * records it in the send log, and remembers who it went to for next time.
 * Returns an error message, or null.
 */
async function sendForAccount(supabase: SupabaseClient, userEmail: string, accountId: string, choice: Choice | null, service: string): Promise<string | null> {
  let invoiceQuery = supabase.from("invoices").select("id, invoice_number, total_cents, due_date, service_month, kind").eq("account_id", accountId).eq("status", "approved").order("invoice_number");
  // Sending from one service's queue only sends that service's invoices.
  if (isServiceCategory(service)) invoiceQuery = invoiceQuery.eq("service_category", service);
  const [account, invoicesRes, settings, defaults, overview] = await Promise.all([
    supabase.from("billing_accounts").select("id, property:properties(name), contacts:billing_contacts(email, is_active, delivery)").eq("id", accountId).single(),
    invoiceQuery,
    supabase.from("app_settings").select("email_sender, email_reply_to, copy_address").maybeSingle(),
    supabase.from("account_send_defaults").select("*").eq("account_id", accountId).maybeSingle(),
    supabase.from("account_overview").select("balance_cents").eq("account_id", accountId).maybeSingle(),
  ]);
  if (account.error) return account.error.message;
  const propertyName = (account.data.property as unknown as { name: string }).name;
  const invoices = invoicesRes.data ?? [];
  if (invoices.length === 0) return null;

  const contacts = ((account.data.contacts ?? []) as { email: string; is_active: boolean; delivery: string }[])
    .filter((c) => c.is_active)
    .map((c) => ({ email: c.email.toLowerCase(), cc: c.delivery === "cc" }));
  const ccContacts = new Set(contacts.filter((c) => c.cc).map((c) => c.email));
  // No explicit choice: use who it went to last time, or every contact the first time.
  const remembered = ((defaults.data?.recipient_emails as string[] | undefined) ?? []).filter((e) => EMAIL.test(e));
  const picked: Choice = choice ?? {
    to: remembered.length ? remembered : contacts.map((c) => c.email),
    copySelf: defaults.data?.send_copy_to_self ?? false,
    copyJr: defaults.data?.send_to_jr ?? false,
  };
  const chosen = [...new Set(picked.to.map((e) => e.trim().toLowerCase()).filter((e) => EMAIL.test(e)))];
  const to = chosen.filter((e) => !ccContacts.has(e));
  if (to.length === 0) return `${propertyName}: there is no one in the To line. Add a contact on the Contacts page.`;
  const cc = [
    ...new Set(
      [...chosen.filter((e) => ccContacts.has(e)), picked.copySelf ? userEmail.toLowerCase() : "", picked.copyJr ? (settings.data?.copy_address ?? "").toLowerCase() : ""].filter(
        (e) => EMAIL.test(e) && !to.includes(e),
      ),
    ),
  ];

  const attachments: Attachment[] = [];
  for (const inv of invoices) {
    const stored = await supabase.storage.from("invoices").download(pdfPath(accountId, inv.id));
    let content: Buffer;
    if (stored.data) content = Buffer.from(await stored.data.arrayBuffer());
    else {
      const doc = await buildInvoiceDocument(supabase, inv.id);
      if (!doc) return `${propertyName}: invoice ${inv.invoice_number} could not be prepared.`;
      content = await renderToBuffer(<InvoicePdf doc={doc} />);
    }
    attachments.push({ filename: `Kaizen Waste Invoice ${inv.invoice_number}.pdf`, content });
  }

  const replyTo = settings.data?.email_reply_to ?? userEmail;
  const { subject, text } = invoiceEmail({
    propertyName,
    invoices: invoices.map((i) => ({ number: Number(i.invoice_number), totalCents: Number(i.total_cents), dueDate: i.due_date, serviceMonth: i.service_month, kind: i.kind })),
    balanceCents: Number(overview.data?.balance_cents ?? 0),
    replyTo,
  });
  const sent = await sendEmail({ from: settings.data?.email_sender ?? "Kaizen Waste <invoices@kaizen-waste.com>", to, cc, replyTo, subject, text, attachments });
  if ("error" in sent) return `${propertyName}: ${sent.error}`;

  const now = new Date().toISOString();
  const log = await supabase.from("email_sends").insert(
    invoices.map((i) => ({ account_id: accountId, invoice_id: i.id, kind: "invoice", recipients: to, cc, subject, sent_at: now, provider_message_id: sent.id })),
  );
  const marked = await supabase.from("invoices").update({ status: "sent", sent_at: now }).in("id", invoices.map((i) => i.id)).eq("status", "approved");
  const saved = await supabase
    .from("account_send_defaults")
    .upsert({ account_id: accountId, recipient_emails: chosen, send_copy_to_self: picked.copySelf, send_to_jr: picked.copyJr }, { onConflict: "account_id" });
  const problem = log.error ?? marked.error ?? saved.error;
  return problem ? `${propertyName}: the email was sent, but recording it failed: ${problem.message}` : null;
}

export async function sendOne(fd: FormData) {
  const { supabase, user } = await requireAdmin();
  const accountId = String(fd.get("account_id") ?? "");
  const service = String(fd.get("service") ?? "");
  const extra = String(fd.get("extra") ?? "").split(/[,;\s]+/).filter(Boolean);
  const bad = extra.find((e) => !EMAIL.test(e));
  if (bad) back("error", `"${bad}" does not look like an email address.`, service);
  const problem = await sendForAccount(
    supabase,
    user.email ?? "",
    accountId,
    { to: [...fd.getAll("to").map(String), ...extra], copySelf: fd.get("copy_self") === "on", copyJr: fd.get("copy_jr") === "on" },
    service,
  );
  if (problem) back("error", problem, service);
  back("saved", "Sent.", service);
}

/** Sends everything in the queue being looked at: one service, or all of them. */
export async function sendAll(fd: FormData) {
  const { supabase, user } = await requireAdmin();
  const service = String(fd.get("service") ?? "");
  let query = supabase.from("invoices").select("account_id").eq("status", "approved");
  if (isServiceCategory(service)) query = query.eq("service_category", service);
  const { data, error } = await query;
  if (error) back("error", error.message, service);
  const accounts = [...new Set((data ?? []).map((r) => r.account_id as string))];
  let sent = 0;
  const problems: string[] = [];
  for (const accountId of accounts) {
    const problem = await sendForAccount(supabase, user.email ?? "", accountId, null, service);
    if (problem) problems.push(problem);
    else sent++;
  }
  back(problems.length ? "error" : "saved", `${sent} email${sent === 1 ? "" : "s"} sent.${problems.length ? ` Not sent: ${problems.join(" ")}` : ""}`, service);
}
