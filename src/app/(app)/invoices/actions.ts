"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { approveOne } from "@/lib/billing/approve";
import { addDays, monthEnd, monthStart } from "@/lib/billing/dates";
import { lineAmountCents, parseDollarsToCents, parseSignedDollarsToCents } from "@/lib/money";
import { isServiceCategory } from "@/lib/services";

const text = (fd: FormData, key: string) => String(fd.get(key) ?? "").trim();
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type FormResult = { error: string } | undefined;

/** Creates a one-off invoice. It is a draft until approved, like every other invoice. */
export async function createInvoice(fd: FormData): Promise<FormResult> {
  const { supabase } = await requireAdmin();

  let accountId = text(fd, "account_id");
  const invoiceDate = text(fd, "invoice_date");
  const netDays = text(fd, "net_days");
  if (!DATE.test(invoiceDate)) return { error: "Choose the invoice date." };
  if (!/^\d+$/.test(netDays)) return { error: "Choose the payment terms." };

  // Lines first, so nothing is created if the invoice itself is not valid.
  const itemIds = fd.getAll("line_item").map(String);
  const descriptions = fd.getAll("line_description").map(String);
  const quantities = fd.getAll("line_quantity").map(String);
  const rates = fd.getAll("line_rate").map(String);
  const { data: items } = await supabase.from("service_items").select("id, name, category");
  const itemById = new Map((items ?? []).map((i) => [i.id as string, i]));
  const lines: Record<string, unknown>[] = [];
  let category = "";
  for (let i = 0; i < descriptions.length; i++) {
    const description = (descriptions[i] ?? "").trim();
    const quantity = (quantities[i] ?? "").trim() || "1";
    const rateText = (rates[i] ?? "").trim();
    const item = itemById.get(itemIds[i] ?? "");
    if (!description && !rateText && !item) continue;
    const label = description || item?.name || "";
    if (!label) return { error: `Line ${i + 1} needs a product or service, or a description.` };
    const rate = parseSignedDollarsToCents(rateText);
    if (rate === null) return { error: `Enter a rate for "${label}", for example 350.00.` };
    const amount = lineAmountCents(quantity, rate);
    if (amount === null || Number(quantity) <= 0) return { error: `The quantity for "${label}" must be a number above zero, with at most two decimals.` };
    if (!category && item && isServiceCategory(item.category)) category = item.category;
    lines.push({
      line_type: amount < 0 ? "adjustment" : "per_event",
      description: label,
      quantity,
      unit_price_cents: rate,
      amount_cents: amount,
      service_item_id: item?.id ?? "",
      period_start: invoiceDate,
      period_end: invoiceDate,
    });
  }
  if (lines.length === 0) return { error: "Add at least one line." };
  const total = lines.reduce((sum, l) => sum + (l.amount_cents as number), 0);
  if (total < 0) return { error: "The invoice total cannot be negative. Use a credit memo to give money back." };

  if (accountId === "new") {
    const name = text(fd, "new_customer_name");
    const client = text(fd, "new_client_name") || name;
    const email = text(fd, "new_customer_email").toLowerCase();
    if (!name) return { error: "Enter the new customer's name." };
    if (email && !EMAIL.test(email)) return { error: "The new customer's email does not look right." };
    const existingClient = await supabase.from("customers").select("id").ilike("name", client).limit(1);
    const created = await supabase.rpc("create_billing_account", {
      p: {
        customer_id: existingClient.data?.[0]?.id ?? "",
        customer_name: client,
        property: { name },
        contacts: email ? [{ name: text(fd, "new_customer_contact") || "Accounts payable", email }] : [],
        contract: { billing_model: "as_needed", net_days: netDays },
        phases: [],
      },
    });
    if (created.error) return { error: `The customer was not saved: ${created.error.message}` };
    accountId = created.data as string;
  }
  if (!accountId) return { error: "Choose a customer." };

  const { data, error } = await supabase.rpc("create_draft_invoice", {
    p: {
      account_id: accountId,
      service_month: monthStart(invoiceDate),
      invoice_date: invoiceDate,
      due_date: addDays(invoiceDate, Number(netDays)),
      subtotal_cents: total,
      tax_cents: 0,
      total_cents: total,
      kind: "ad_hoc",
      service_category: category || "other",
      memo: text(fd, "memo"),
      lines,
    },
  });
  if (error) return { error: `The invoice was not saved: ${error.message}` };
  const invoiceId = data as string;

  // Repeat every month: save these lines as a recurring invoice, starting next month.
  if (fd.get("repeat") === "on") {
    const day = Math.min(28, Math.max(1, Number(text(fd, "repeat_day")) || Number(invoiceDate.slice(8, 10))));
    const start = addDays(monthEnd(invoiceDate), 1);
    const saved = await supabase.from("recurring_invoices").insert({
      account_id: accountId,
      name: text(fd, "repeat_name") || String(lines[0].description),
      service_category: category || "other",
      day_of_month: day,
      start_month: start,
      net_days: Number(netDays),
      memo: text(fd, "memo") || null,
      lines: lines.map((l) => ({ service_item_id: l.service_item_id || null, description: l.description, quantity: l.quantity, unit_price_cents: l.unit_price_cents })),
    });
    if (saved.error) return { error: `The invoice was saved, but it could not be set to repeat: ${saved.error.message}` };
    revalidatePath("/schedule");
  }
  revalidatePath("/review");
  revalidatePath("/accounts");

  if (text(fd, "intent") === "approve") {
    const problem = await approveOne(supabase, invoiceId);
    if (problem) redirect(`/invoices/${invoiceId}?error=${encodeURIComponent(problem.startsWith("Approved") ? problem : `Saved as a draft. ${problem}`)}`);
    redirect(`/invoices/${invoiceId}?saved=${encodeURIComponent("Invoice approved and posted to the account.")}`);
  }
  redirect(`/invoices/${invoiceId}?saved=${encodeURIComponent("Draft saved. It is waiting in the review queue.")}`);
}

// ---------------------------------------------------------------------------
// Products and services
// ---------------------------------------------------------------------------

function backToItems(kind: "saved" | "error", message: string): never {
  revalidatePath("/items");
  redirect(`/items?${kind}=${encodeURIComponent(message)}`);
}

export async function saveItem(fd: FormData) {
  const { supabase } = await requireAdmin();
  const id = text(fd, "item_id");
  const name = text(fd, "name");
  const rateText = text(fd, "rate");
  const rate = rateText ? parseSignedDollarsToCents(rateText) : null;
  if (!name) backToItems("error", "Enter a name.");
  if (rateText && rate === null) backToItems("error", `The price for ${name} is not a valid amount.`);
  const category = text(fd, "category");
  const values = {
    name,
    category: isServiceCategory(category) ? category : "other",
    description: text(fd, "description") || null,
    default_rate_cents: rate,
    is_active: id ? fd.get("is_active") === "on" : true,
  };
  const { error } = id
    ? await supabase.from("service_items").update(values).eq("id", id)
    : await supabase.from("service_items").insert(values);
  if (error) backToItems("error", error.message.includes("duplicate") ? `There is already an item called ${name}.` : error.message);
  backToItems("saved", id ? `${name} saved.` : `${name} added.`);
}

/** Removes an item. One that has been used on an invoice is kept for the record and just taken off the list. */
export async function removeItem(fd: FormData) {
  const { supabase } = await requireAdmin();
  const id = text(fd, "item_id");
  const name = text(fd, "name");
  const used = await supabase.from("invoice_lines").select("id").eq("service_item_id", id).limit(1);
  if (used.error) backToItems("error", used.error.message);
  if (used.data?.length) {
    const { error } = await supabase.from("service_items").update({ is_active: false }).eq("id", id);
    if (error) backToItems("error", error.message);
    backToItems("saved", `${name} has been used on an invoice, so it was moved to "No longer in use" instead of deleted.`);
  }
  const { error } = await supabase.from("service_items").delete().eq("id", id);
  if (error) backToItems("error", error.message);
  backToItems("saved", `${name} removed.`);
}

function toInvoice(id: string, kind: "saved" | "error", message: string): never {
  revalidatePath("/", "layout");
  redirect(`/invoices/${id}?${kind}=${encodeURIComponent(message)}`);
}

/** Voids a posted invoice. It stays on file with its number; its amount comes off the balance. */
export async function voidInvoice(fd: FormData) {
  const { supabase } = await requireAdmin();
  const id = text(fd, "invoice_id");
  const reason = text(fd, "reason");
  if (!reason) toInvoice(id, "error", "Enter the reason for voiding this invoice.");
  const { error } = await supabase.rpc("void_invoice", { p_invoice_id: id, p_reason: reason });
  if (error) toInvoice(id, "error", error.message);
  toInvoice(id, "saved", "Invoice voided. Its amount has come off the balance, and the month can be drafted again.");
}

/** Issues a credit memo against an invoice. */
export async function creditInvoice(fd: FormData) {
  const { supabase } = await requireAdmin();
  const id = text(fd, "invoice_id");
  const amount = parseDollarsToCents(text(fd, "amount"));
  const reason = text(fd, "reason");
  if (amount === null || amount <= 0) toInvoice(id, "error", "Enter the credit amount, for example 50.00.");
  if (!reason) toInvoice(id, "error", "Enter the reason for the credit.");
  const { error } = await supabase.rpc("issue_credit_memo", { p_account_id: text(fd, "account_id"), p_invoice_id: id, p_amount_cents: amount, p_reason: reason });
  if (error) toInvoice(id, "error", error.message);
  toInvoice(id, "saved", "Credit applied. It has come off this invoice and the balance.");
}
