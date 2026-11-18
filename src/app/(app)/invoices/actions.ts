"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { approveOne } from "@/lib/billing/approve";
import { addDays, monthEnd, monthStart } from "@/lib/billing/dates";
import { lineAmountCents, parseDollarsToCents, parseSignedDollarsToCents } from "@/lib/money";
import { BLOCKS } from "@/lib/pdf/template";
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
  const dates = fd.getAll("line_date").map(String);
  const newNames = fd.getAll("line_item_new").map(String);
  const newCategories = fd.getAll("line_item_new_category").map(String);
  // A product or service typed in fresh on a line: saved once the invoice itself is known to be valid.
  const toCreate = new Map<string, { name: string; category: string; rate: number }>();
  const { data: items } = await supabase.from("service_items").select("id, name, category");
  const itemById = new Map((items ?? []).map((i) => [i.id as string, i]));
  const lines: Record<string, unknown>[] = [];
  let category = "";
  for (let i = 0; i < descriptions.length; i++) {
    const description = (descriptions[i] ?? "").trim();
    const quantity = (quantities[i] ?? "").trim() || "1";
    const rateText = (rates[i] ?? "").trim();
    const item = itemById.get(itemIds[i] ?? "");
    const newName = (newNames[i] ?? "").trim();
    if (!description && !rateText && !item && !newName) continue;
    const label = description || item?.name || newName;
    const serviceDate = (dates[i] ?? "").trim() || invoiceDate;
    if (!DATE.test(serviceDate)) return { error: `The date of service for "${label}" does not look right.` };
    if (!label) return { error: `Line ${i + 1} needs a product or service, or a description.` };
    const rate = parseSignedDollarsToCents(rateText);
    if (rate === null) return { error: `Enter a rate for "${label}", for example 350.00.` };
    const amount = lineAmountCents(quantity, rate);
    if (amount === null || Number(quantity) <= 0) return { error: `The quantity for "${label}" must be a number above zero, with at most two decimals.` };
    const typedCategory = isServiceCategory(newCategories[i]) ? (newCategories[i] as string) : "other";
    if (!item && newName && !toCreate.has(newName.toLowerCase())) toCreate.set(newName.toLowerCase(), { name: newName, category: typedCategory, rate });
    if (!category && item && isServiceCategory(item.category)) category = item.category;
    if (!category && !item && newName) category = typedCategory;
    lines.push({
      line_type: amount < 0 ? "adjustment" : "per_event",
      description: label,
      quantity,
      unit_price_cents: rate,
      amount_cents: amount,
      service_item_id: item?.id ?? "",
      new_item: !item && newName ? newName.toLowerCase() : "",
      period_start: serviceDate,
      period_end: serviceDate,
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

  // The same property, date and amount as a bill that already exists is never made twice.
  {
    const twin = await supabase.from("invoices").select("invoice_number, status").eq("account_id", accountId).eq("invoice_date", invoiceDate).eq("total_cents", total).neq("status", "void").limit(1);
    if (twin.error) return { error: twin.error.message };
    const found = twin.data?.[0];
    if (found) {
      return { error: `Duplicate: ${found.invoice_number ? `invoice ${found.invoice_number}` : "a draft"} already exists for this customer on the same date for the same amount, so this one was not saved. If it is a different bill, change the date or the lines. If the other one is wrong, reject or void it first.` };
    }
  }

  // New products and services typed on the lines are added to the list now.
  for (const fresh of toCreate.values()) {
    const existing = await supabase.from("service_items").select("id").ilike("name", fresh.name).limit(1);
    if (existing.error) return { error: existing.error.message };
    let id = existing.data?.[0]?.id as string | undefined;
    if (!id) {
      const made = await supabase.from("service_items").insert({ name: fresh.name, category: fresh.category, default_rate_cents: fresh.rate }).select("id").single();
      if (made.error) return { error: `"${fresh.name}" could not be added to products and services: ${made.error.message}` };
      id = made.data.id as string;
      revalidatePath("/items");
    }
    for (const l of lines) if (l.new_item === fresh.name.toLowerCase()) l.service_item_id = id;
  }
  for (const l of lines) delete l.new_item;

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

  // Blocks switched on or off for this invoice only, from the preview on the form.
  const layoutText = text(fd, "layout_options");
  if (layoutText) {
    let chosen: Record<string, boolean> = {};
    try {
      const parsed = JSON.parse(layoutText) as Record<string, unknown>;
      chosen = Object.fromEntries(BLOCKS.filter((b) => typeof parsed[b.key] === "boolean").map((b) => [b.key, parsed[b.key] as boolean]));
    } catch {
      chosen = {};
    }
    if (Object.keys(chosen).length) {
      const saved = await supabase.from("invoices").update({ layout_options: chosen }).eq("id", invoiceId);
      if (saved.error) return { error: `The invoice was saved as a draft, but its layout choices were not: ${saved.error.message}` };
    }
  }

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
  const { data: row } = await supabase.from("invoices").select("qbo_invoice_id").eq("id", id).maybeSingle();
  toInvoice(id, "saved", `Invoice voided. Its amount has come off the balance, and the month can be drafted again.${row?.qbo_invoice_id ? " It is still in QuickBooks: void it there too, so the books match." : ""}`);
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

/** Adds one line to a draft, for an extra such as a replacement can. Posted invoices cannot be changed. */
export async function addDraftLine(fd: FormData) {
  const { supabase } = await requireAdmin();
  const id = text(fd, "invoice_id");
  const { data: invoice } = await supabase.from("invoices").select("id, status, invoice_date, total_cents").eq("id", id).maybeSingle();
  if (!invoice) toInvoice(id, "error", "Invoice not found.");
  if (invoice!.status !== "draft") toInvoice(id, "error", "Only a draft can be changed. Use a credit, or void and reissue.");

  const itemId = text(fd, "line_item");
  const newName = text(fd, "line_item_new");
  const description = text(fd, "description");
  const quantity = text(fd, "quantity") || "1";
  const rate = parseSignedDollarsToCents(text(fd, "rate"));
  const serviceDate = text(fd, "line_date") || (invoice!.invoice_date as string);
  if (!DATE.test(serviceDate)) toInvoice(id, "error", "The date of service does not look right.");
  let item = itemId ? (await supabase.from("service_items").select("id, name").eq("id", itemId).maybeSingle()).data : null;
  const label = description || item?.name || newName;
  if (!label) toInvoice(id, "error", "Choose a product or service, or type a description.");
  if (rate === null) toInvoice(id, "error", `Enter a rate for "${label}", for example 25.00.`);
  const amount = lineAmountCents(quantity, rate!);
  if (amount === null || Number(quantity) <= 0) toInvoice(id, "error", "The quantity must be a number above zero, with at most two decimals.");
  if (Number(invoice!.total_cents) + amount! < 0) toInvoice(id, "error", "That would make the invoice total negative. Use a credit memo to give money back.");

  // A product typed in fresh is added to the list, unless one by that name is already there.
  if (!item && newName) {
    const existing = await supabase.from("service_items").select("id, name").ilike("name", newName).limit(1);
    item = existing.data?.[0] ?? null;
    if (!item) {
      const category = text(fd, "line_item_new_category");
      const made = await supabase.from("service_items").insert({ name: newName, category: isServiceCategory(category) ? category : "other", default_rate_cents: rate }).select("id, name").single();
      if (made.error) toInvoice(id, "error", `"${newName}" could not be added to products and services: ${made.error.message}`);
      item = made.data;
      revalidatePath("/items");
    }
  }
  const last = await supabase.from("invoice_lines").select("sort_order").eq("invoice_id", id).order("sort_order", { ascending: false }).limit(1);
  const { error } = await supabase.from("invoice_lines").insert({
    invoice_id: id, line_type: amount! < 0 ? "adjustment" : "per_event", description: label, quantity, unit_price_cents: rate, amount_cents: amount,
    service_item_id: item?.id ?? null, period_start: serviceDate, period_end: serviceDate, sort_order: Number(last.data?.[0]?.sort_order ?? -1) + 1,
  });
  if (error) toInvoice(id, "error", error.message);
  const recalc = await supabase.rpc("recalculate_draft", { p_invoice_id: id });
  if (recalc.error) toInvoice(id, "error", recalc.error.message);
  toInvoice(id, "saved", `Added "${label}". The total is updated.`);
}

/** Takes one line off a draft. */
export async function removeDraftLine(fd: FormData) {
  const { supabase } = await requireAdmin();
  const id = text(fd, "invoice_id");
  const lineId = text(fd, "line_id");
  const [{ data: lines }, { data: invoice }] = await Promise.all([
    supabase.from("invoice_lines").select("id, amount_cents").eq("invoice_id", id),
    supabase.from("invoices").select("status").eq("id", id).maybeSingle(),
  ]);
  if (invoice?.status !== "draft") toInvoice(id, "error", "Only a draft can be changed.");
  const rest = (lines ?? []).filter((l) => l.id !== lineId);
  if (rest.length === 0) toInvoice(id, "error", "This is the only line. To drop the whole invoice, reject the draft in Review.");
  if (rest.reduce((sum, l) => sum + Number(l.amount_cents), 0) < 0) toInvoice(id, "error", "Removing that line would make the total negative.");
  const { error } = await supabase.from("invoice_lines").delete().eq("id", lineId).eq("invoice_id", id);
  if (error) toInvoice(id, "error", error.message);
  const recalc = await supabase.rpc("recalculate_draft", { p_invoice_id: id });
  if (recalc.error) toInvoice(id, "error", recalc.error.message);
  toInvoice(id, "saved", "Line removed. The total is updated.");
}

/** Changes a draft's dates and message. */
export async function saveDraftDetails(fd: FormData) {
  const { supabase } = await requireAdmin();
  const id = text(fd, "invoice_id");
  const invoiceDate = text(fd, "invoice_date");
  const dueDate = text(fd, "due_date");
  if (!DATE.test(invoiceDate) || !DATE.test(dueDate)) toInvoice(id, "error", "Enter both the invoice date and the due date.");
  if (dueDate < invoiceDate) toInvoice(id, "error", "The due date cannot be before the invoice date.");
  const { data: invoice } = await supabase.from("invoices").select("status, kind, invoice_date, service_month").eq("id", id).maybeSingle();
  if (invoice?.status !== "draft") toInvoice(id, "error", "Only a draft can be changed. Use a credit, or void and reissue.");
  // A one-off invoice belongs to the month it is dated in, so its month follows the date. A monthly invoice,
  // or a one-off made for an earlier month (back-billing), keeps the month it was made for.
  const values: Record<string, unknown> = { invoice_date: invoiceDate, due_date: dueDate, memo: text(fd, "memo") || null };
  if (invoice!.kind === "ad_hoc" && invoice!.service_month === monthStart(invoice!.invoice_date as string)) values.service_month = monthStart(invoiceDate);
  const { error } = await supabase.from("invoices").update(values).eq("id", id).eq("status", "draft");
  if (error) toInvoice(id, "error", error.message);
  toInvoice(id, "saved", "Dates and message saved.");
}

/** Changes one line on a draft: its date of service, wording, quantity and rate. */
export async function saveDraftLine(fd: FormData) {
  const { supabase } = await requireAdmin();
  const id = text(fd, "invoice_id");
  const lineId = text(fd, "line_id");
  const description = text(fd, "description");
  const quantity = text(fd, "quantity") || "1";
  const rate = parseSignedDollarsToCents(text(fd, "rate"));
  const serviceDate = text(fd, "line_date");
  if (!description) toInvoice(id, "error", "A line needs a description.");
  if (rate === null) toInvoice(id, "error", "Enter the rate, for example 350.00.");
  if (serviceDate && !DATE.test(serviceDate)) toInvoice(id, "error", "The date of service does not look right.");
  const amount = lineAmountCents(quantity, rate!);
  if (amount === null || Number(quantity) <= 0) toInvoice(id, "error", "The quantity must be a number above zero, with at most two decimals.");
  const [{ data: invoice }, { data: lines }] = await Promise.all([
    supabase.from("invoices").select("status").eq("id", id).maybeSingle(),
    supabase.from("invoice_lines").select("id, amount_cents").eq("invoice_id", id),
  ]);
  if (invoice?.status !== "draft") toInvoice(id, "error", "Only a draft can be changed.");
  const total = (lines ?? []).reduce((sum, l) => sum + (l.id === lineId ? amount! : Number(l.amount_cents)), 0);
  if (total < 0) toInvoice(id, "error", "That would make the invoice total negative. Use a credit memo to give money back.");
  const values: Record<string, unknown> = { description, quantity, unit_price_cents: rate, amount_cents: amount };
  if (serviceDate) Object.assign(values, { period_start: serviceDate, period_end: serviceDate });
  const { error } = await supabase.from("invoice_lines").update(values).eq("id", lineId).eq("invoice_id", id);
  if (error) toInvoice(id, "error", error.message);
  const recalc = await supabase.rpc("recalculate_draft", { p_invoice_id: id });
  if (recalc.error) toInvoice(id, "error", recalc.error.message);
  toInvoice(id, "saved", "Line saved. The total is updated.");
}
