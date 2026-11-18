"use server";

import { todayInPhoenix } from "@/lib/billing/dates";
import { draftLateFees } from "@/lib/billing/late-fee-drafts";
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
async function sendForAccount(
  supabase: SupabaseClient,
  userEmail: string,
  accountId: string,
  choice: Choice | null,
  service: string,
  custom: { subject: string; text: string } | null = null,
): Promise<string | null> {
  let invoiceQuery = supabase.from("invoices").select("id, invoice_number, total_cents, due_date, service_month, kind").eq("account_id", accountId).eq("status", "approved").order("invoice_number");
  // Sending from one service's queue only sends that service's invoices.
  if (isServiceCategory(service)) invoiceQuery = invoiceQuery.eq("service_category", service);
  const [account, invoicesRes, settings, defaults, overview] = await Promise.all([
    supabase.from("billing_accounts").select("id, property:properties(name), contacts:billing_contacts(email, is_active, delivery)").eq("id", accountId).single(),
    invoiceQuery,
    supabase.from("app_settings").select("email_sender, email_reply_to, copy_address, always_cc").maybeSingle(),
    supabase.from("account_send_defaults").select("*").eq("account_id", accountId).maybeSingle(),
    supabase.from("account_overview").select("balance_cents").eq("account_id", accountId).maybeSingle(),
  ]);
  if (account.error) return account.error.message;
  const propertyName = (account.data.property as unknown as { name: string }).name;
  // Anything held back from sending is left out.
  const held = new Set(((await supabase.from("send_holds").select("invoice_id")).data ?? []).map((h) => h.invoice_id as string));
  const invoices = (invoicesRes.data ?? []).filter((i) => !held.has(i.id));
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
      [...chosen.filter((e) => ccContacts.has(e)), ...((settings.data?.always_cc as string[] | null) ?? []).map((e) => e.toLowerCase()), picked.copySelf ? userEmail.toLowerCase() : "", picked.copyJr ? (settings.data?.copy_address ?? "").toLowerCase() : ""].filter(
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
  const standard = invoiceEmail({
    propertyName,
    invoices: invoices.map((i) => ({ number: Number(i.invoice_number), totalCents: Number(i.total_cents), dueDate: i.due_date, serviceMonth: i.service_month, kind: i.kind })),
    balanceCents: Number(overview.data?.balance_cents ?? 0),
    replyTo,
  });
  // Wording edited on the Send page replaces the standard wording for this email only.
  const subject = custom?.subject.trim() || standard.subject;
  const text = custom?.text.trim() || standard.text;
  const sent = await sendEmail({ from: settings.data?.email_sender ?? "Kaizen Waste <no-reply@msg.kaizen-waste.com>", to, cc, replyTo, subject, text, attachments });
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
    { subject: String(fd.get("subject") ?? ""), text: String(fd.get("body") ?? "") },
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

/**
 * Sends the reminder for one invoice that reached its due date unpaid. The
 * wording shown on the page (edited or not) is what goes out.
 */
export async function sendReminder(fd: FormData) {
  const { supabase, user } = await requireAdmin();
  const invoiceId = String(fd.get("invoice_id") ?? "");
  // Sent from an invoice's own page, the result is shown there; otherwise on the unpaid list.
  const fromInvoicePage = fd.get("return_to") === "invoice";
  const done = (kind: "saved" | "error", message: string): never => {
    revalidatePath("/invoices");
    revalidatePath("/");
    redirect(fromInvoicePage ? `/invoices/${invoiceId}?${kind}=${encodeURIComponent(message)}` : `/invoices?view=unpaid&${kind}=${encodeURIComponent(message)}`);
  };
  const subject = String(fd.get("subject") ?? "").trim();
  const text = String(fd.get("body") ?? "").trim();
  if (!subject || !text) done("error", "The reminder needs a subject and a message.");

  const { data: invoice, error } = await supabase
    .from("invoices")
    .select("id, account_id, invoice_number, status, origin, account:billing_accounts(property:properties(name), contacts:billing_contacts(email, is_active, delivery))")
    .eq("id", invoiceId)
    .single();
  if (error) done("error", error.message);
  if (!["sent", "partially_paid"].includes(invoice!.status)) done("error", "A reminder can only go out for an invoice that has been sent and is not paid.");
  const account = invoice!.account as unknown as { property: { name: string }; contacts: { email: string; is_active: boolean; delivery: string }[] };
  const contacts = account.contacts.filter((c) => c.is_active);
  const to = contacts.filter((c) => c.delivery !== "cc").map((c) => c.email.toLowerCase());
  const { data: settings } = await supabase.from("app_settings").select("email_sender, email_reply_to, always_cc").maybeSingle();
  const cc = [...new Set([...contacts.filter((c) => c.delivery === "cc").map((c) => c.email.toLowerCase()), ...((settings?.always_cc as string[] | null) ?? []).map((e) => e.toLowerCase())])].filter((e) => !to.includes(e));
  if (to.length === 0) done("error", `${account.property.name} has no one in the To line. Add a contact first.`);

  // An invoice first sent from QuickBooks goes out without a redrawn copy: the customer has the original.
  const attachments: Attachment[] = [];
  if (invoice!.origin !== "quickbooks_import") {
    const stored = await supabase.storage.from("invoices").download(pdfPath(invoice!.account_id, invoiceId));
    let content: Buffer;
    if (stored.data) content = Buffer.from(await stored.data.arrayBuffer());
    else {
      const doc = await buildInvoiceDocument(supabase, invoiceId);
      if (!doc) done("error", "The invoice could not be prepared.");
      content = await renderToBuffer(<InvoicePdf doc={doc!} />);
    }
    attachments.push({ filename: `Kaizen Waste Invoice ${invoice!.invoice_number}.pdf`, content });
  }
  const sent = await sendEmail({
    from: settings?.email_sender ?? "Kaizen Waste <no-reply@msg.kaizen-waste.com>",
    to,
    cc,
    replyTo: settings?.email_reply_to ?? user.email,
    subject,
    text,
    attachments,
  });
  if ("error" in sent) done("error", `${account.property.name}: ${sent.error}`);
  const log = await supabase.from("email_sends").insert({
    account_id: invoice!.account_id, invoice_id: invoiceId, kind: "reminder", recipients: to, cc, subject,
    sent_at: new Date().toISOString(), provider_message_id: (sent as { id: string }).id,
  });
  if (log.error) done("error", `The reminder was sent, but recording it failed: ${log.error.message}`);
  done("saved", `Reminder sent for invoice ${invoice!.invoice_number}.`);
}

/** Notes that no reminder is needed for an invoice (for example the check is already in hand). */
export async function dismissReminder(fd: FormData) {
  const { supabase } = await requireAdmin();
  const invoiceId = String(fd.get("invoice_id") ?? "");
  const { data: invoice } = await supabase.from("invoices").select("account_id, invoice_number").eq("id", invoiceId).single();
  const { error } = await supabase.from("email_sends").insert({
    account_id: invoice?.account_id, invoice_id: invoiceId, kind: "reminder", recipients: [], subject: "No reminder sent: dismissed", sent_at: new Date().toISOString(),
  });
  revalidatePath("/invoices");
  revalidatePath("/");
  redirect(`/invoices?view=unpaid&${error ? "error" : "saved"}=${encodeURIComponent(error ? error.message : `No reminder will be sent for invoice ${invoice?.invoice_number}.`)}`);
}

/** Drafts any late fees that have fallen due. They wait in Review; nothing is charged until approved. */
export async function checkLateFees() {
  const { supabase } = await requireAdmin();
  const run = await draftLateFees(supabase, todayInPhoenix());
  revalidatePath("/", "layout");
  const message = run.created
    ? `${run.created} late fee${run.created === 1 ? "" : "s"} drafted. Approve or reject ${run.created === 1 ? "it" : "them"} in Review.`
    : "No new late fees are due.";
  redirect(`/invoices?view=unpaid&${run.problems.length ? "error" : "saved"}=${encodeURIComponent(run.problems.length ? `${message} Problems: ${run.problems.join("; ")}` : message)}`);
}

/** Reads which overdue invoices a notice form covers, keeping only real, unpaid, sent invoices on that property. */
async function noticeInvoices(supabase: Awaited<ReturnType<typeof requireAdmin>>["supabase"], fd: FormData) {
  const accountId = String(fd.get("account_id") ?? "");
  const ids = String(fd.get("invoice_ids") ?? "").split(",").filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  const { data } = await supabase.from("invoices").select("id, account_id, invoice_number, origin, status").in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]).eq("account_id", accountId).in("status", ["sent", "partially_paid"]);
  return { accountId, invoices: (data ?? []) as { id: string; account_id: string; invoice_number: number; origin: string; status: string }[] };
}

/** Sends one overdue notice for a property, covering every invoice listed on the form. */
export async function sendOverdueNotice(fd: FormData) {
  const { supabase, user } = await requireAdmin();
  const done = (kind: "saved" | "error", message: string): never => {
    revalidatePath("/", "layout");
    redirect(`/invoices?view=unpaid&${kind}=${encodeURIComponent(message)}`);
  };
  const subject = String(fd.get("subject") ?? "").trim();
  const text = String(fd.get("body") ?? "").trim();
  if (!subject || !text) done("error", "The notice needs a subject and a message.");
  const { accountId, invoices } = await noticeInvoices(supabase, fd);
  if (invoices.length === 0) done("error", "There is nothing overdue to send a notice for. It may have been paid a moment ago.");

  const [account, settings] = await Promise.all([
    supabase.from("billing_accounts").select("property:properties(name), contacts:billing_contacts(email, is_active, delivery)").eq("id", accountId).single(),
    supabase.from("app_settings").select("email_sender, email_reply_to, always_cc").maybeSingle(),
  ]);
  if (account.error) done("error", account.error.message);
  const acct = account.data as unknown as { property: { name: string }; contacts: { email: string; is_active: boolean; delivery: string }[] };
  const contacts = acct.contacts.filter((c) => c.is_active);
  const to = contacts.filter((c) => c.delivery !== "cc").map((c) => c.email.toLowerCase());
  if (to.length === 0) done("error", `${acct.property.name} has no one in the To line. Add a contact first.`);
  const cc = [...new Set([...contacts.filter((c) => c.delivery === "cc").map((c) => c.email.toLowerCase()), ...((settings.data?.always_cc as string[] | null) ?? []).map((e) => e.toLowerCase())])].filter((e) => !to.includes(e));

  // Copies of invoices made in this app are attached. Ones first sent from QuickBooks are not: the customer has the original.
  const attachments: Attachment[] = [];
  for (const inv of invoices.filter((i) => i.origin !== "quickbooks_import")) {
    const stored = await supabase.storage.from("invoices").download(pdfPath(inv.account_id, inv.id));
    if (stored.data) attachments.push({ filename: `Kaizen Waste Invoice ${inv.invoice_number}.pdf`, content: Buffer.from(await stored.data.arrayBuffer()) });
  }
  const sent = await sendEmail({ from: settings.data?.email_sender ?? "Kaizen Waste <no-reply@msg.kaizen-waste.com>", to, cc, replyTo: settings.data?.email_reply_to ?? user.email ?? null, subject, text, attachments });
  if ("error" in sent) done("error", `${acct.property.name}: ${sent.error}`);
  const now = new Date().toISOString();
  const log = await supabase.from("email_sends").insert(invoices.map((inv) => ({ account_id: accountId, invoice_id: inv.id, kind: "reminder", recipients: to, cc, subject, sent_at: now, provider_message_id: (sent as { id: string }).id })));
  if (log.error) done("error", `The notice was sent, but recording it failed: ${log.error.message}`);
  done("saved", `Overdue notice sent to ${acct.property.name}, covering invoice${invoices.length === 1 ? "" : "s"} ${invoices.map((i) => i.invoice_number).join(", ")}.`);
}

/** Notes that no notice is needed for a property's overdue invoices (for example the check is in hand). */
export async function dismissOverdueNotice(fd: FormData) {
  const { supabase } = await requireAdmin();
  const { accountId, invoices } = await noticeInvoices(supabase, fd);
  const now = new Date().toISOString();
  const { error } = invoices.length
    ? await supabase.from("email_sends").insert(invoices.map((inv) => ({ account_id: accountId, invoice_id: inv.id, kind: "reminder", recipients: [], subject: "No notice sent: dismissed", sent_at: now })))
    : { error: null };
  revalidatePath("/", "layout");
  redirect(`/invoices?view=unpaid&${error ? "error" : "saved"}=${encodeURIComponent(error ? error.message : "No notice will be sent for those invoices.")}`);
}

/** Holds an approved invoice back from sending, or puts it back. It stays approved and on the account either way. */
export async function holdFromSend(fd: FormData) {
  const { supabase } = await requireAdmin();
  const id = String(fd.get("invoice_id") ?? "");
  const release = fd.get("release") === "yes";
  const { data: invoice } = await supabase.from("invoices").select("invoice_number, status").eq("id", id).maybeSingle();
  const done = (kind: "saved" | "error", message: string): never => {
    revalidatePath("/", "layout");
    redirect(`/send?${kind}=${encodeURIComponent(message)}`);
  };
  if (!invoice) done("error", "Invoice not found.");
  if (invoice!.status !== "approved") done("error", "Only an approved invoice that has not been sent can be held or put back.");
  const { error } = release
    ? await supabase.from("send_holds").delete().eq("invoice_id", id)
    : await supabase.from("send_holds").insert({ invoice_id: id });
  // Already held is not a problem: the result the person wants is the same.
  if (error && error.code !== "23505") done("error", error.message);
  done("saved", release ? `Invoice ${invoice!.invoice_number} is back in the send.` : `Invoice ${invoice!.invoice_number} is held back. It is still approved and on the account, and will not be emailed until you put it back.`);
}
