"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { monthLabel } from "@/lib/billing/dates";
import { generateDrafts } from "@/lib/billing/drafts";
import { lineAmountCents, parseDollarsToCents, parseSignedDollarsToCents } from "@/lib/money";
import { isServiceCategory } from "@/lib/services";
import { approveOne } from "@/lib/billing/approve";

const text = (fd: FormData, key: string) => String(fd.get(key) ?? "").trim();

function backTo(to: string, kind: "saved" | "error", message: string): never {
  revalidatePath("/review");
  revalidatePath("/accounts");
  revalidatePath("/");
  redirect(`${to}${to.includes("?") ? "&" : "?"}${kind}=${encodeURIComponent(message)}`);
}

function back(kind: "saved" | "error", message: string, to = "/review"): never {
  return backTo(to, kind, message);
}

/** The queue a form was submitted from, so the person lands back in the same one. */
const queueOf = (fd: FormData) => {
  const service = text(fd, "return_service");
  return isServiceCategory(service) ? `/review?service=${service}` : "/review";
};

export async function generateDraftsAction(fd: FormData) {
  const { supabase } = await requireAdmin();
  const month = text(fd, "month"); // "2026-11"
  if (!/^\d{4}-\d{2}$/.test(month)) back("error", "Choose a service month.");
  let run;
  try {
    run = await generateDrafts(supabase, `${month}-01`);
  } catch (e) {
    back("error", e instanceof Error ? e.message : "Could not generate drafts.");
  }
  const skipped = run.skipped.map((s) => `${s.property}: ${s.reason}`).join(" ");
  const label = monthLabel(`${month}-01`);
  back(
    run.created.length ? "saved" : "error",
    `${run.created.length} draft${run.created.length === 1 ? "" : "s"} created for ${label}.${skipped ? ` Skipped: ${skipped}` : ""}`,
  );
}

export async function setNextInvoiceNumber(fd: FormData) {
  const { supabase } = await requireAdmin();
  const value = text(fd, "next_invoice_number");
  if (!/^\d+$/.test(value)) back("error", "The next invoice number must be a whole number.");
  const { error } = await supabase.from("app_settings").update({ next_invoice_number: Number(value) }).eq("singleton", true);
  if (error) back("error", error.message);
  back("saved", `The next invoice approved will be number ${value}.`);
}

export async function approveInvoice(fd: FormData) {
  const { supabase } = await requireAdmin();
  const id = text(fd, "invoice_id");
  const problem = await approveOne(supabase, id);
  if (problem) back("error", problem);
  back("saved", "Invoice approved and posted to the account.", `/invoices/${id}`);
}

/** Approves every draft in the queue being looked at: one service, or all of them. */
export async function approveAll(fd: FormData) {
  const { supabase } = await requireAdmin();
  const service = text(fd, "service");
  const home = isServiceCategory(service) ? `/review?service=${service}` : "/review";
  const back = (kind: "saved" | "error", message: string): never => backTo(home, kind, message);
  let query = supabase.from("invoices").select("id").eq("status", "draft").order("created_at");
  if (isServiceCategory(service)) query = query.eq("service_category", service);
  const { data, error } = await query;
  if (error) back("error", error.message);
  let approved = 0;
  const problems: string[] = [];
  for (const row of data ?? []) {
    const problem = await approveOne(supabase, row.id);
    if (problem && !problem.startsWith("Approved")) {
      problems.push(problem);
      break; // The same cause would stop every other draft too.
    }
    approved++;
    if (problem) problems.push(problem);
  }
  back(problems.length ? "error" : "saved", `${approved} invoice${approved === 1 ? "" : "s"} approved.${problems.length ? ` ${problems[0]}` : ""}`);
}

export async function rejectDraft(fd: FormData) {
  const { supabase } = await requireAdmin();
  const home = queueOf(fd);
  const { error } = await supabase.rpc("reject_draft", { p_invoice_id: text(fd, "invoice_id") });
  if (error) backTo(home, "error", error.message);
  backTo(home, "saved", "Draft rejected and removed.");
}

export async function updateDraftLine(fd: FormData) {
  const { supabase } = await requireAdmin();
  const home = queueOf(fd);
  const invoiceId = text(fd, "invoice_id");
  const description = text(fd, "description");
  if (!description) backTo(home, "error", "A line needs a description.");

  // A priced line (so many loads at a rate) is changed by its quantity and rate; any other line by its amount.
  const values: Record<string, unknown> = { description };
  if (fd.has("rate")) {
    const rate = parseSignedDollarsToCents(text(fd, "rate"));
    const quantity = text(fd, "quantity") || "1";
    if (rate === null) backTo(home, "error", "Enter the rate, for example 350.00.");
    const amount = lineAmountCents(quantity, rate!);
    if (amount === null || Number(quantity) <= 0) backTo(home, "error", "The quantity must be a number above zero, with at most two decimals.");
    Object.assign(values, { quantity, unit_price_cents: rate, amount_cents: amount });
  } else {
    const amount = parseDollarsToCents(text(fd, "amount"));
    if (amount === null) backTo(home, "error", "Enter the line amount, for example 1862.50.");
    values.amount_cents = amount;
  }
  const { error } = await supabase.from("invoice_lines").update(values).eq("id", text(fd, "line_id")).eq("invoice_id", invoiceId);
  if (error) backTo(home, "error", error.message);
  const recalc = await supabase.rpc("recalculate_draft", { p_invoice_id: invoiceId });
  if (recalc.error) backTo(home, "error", recalc.error.message);
  backTo(home, "saved", "Line updated.");
}
