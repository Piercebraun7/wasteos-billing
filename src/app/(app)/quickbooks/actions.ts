"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { connect } from "@/lib/quickbooks/client";
import { importOpenInvoices } from "@/lib/quickbooks/import";
import { syncFromQuickBooks, syncNote } from "@/lib/quickbooks/payments";
import { pushInvoice } from "@/lib/quickbooks/push";
import { SERVICE_KEYS } from "./keys";

function done(kind: "saved" | "error", message: string): never {
  revalidatePath("/quickbooks");
  redirect(`/quickbooks?${kind}=${encodeURIComponent(message)}`);
}

/** Saves which QuickBooks customer each property posts to, and which product each service uses. */
export async function saveLinks(fd: FormData) {
  const { supabase } = await requireAdmin();
  const itemMap: Record<string, string> = {};
  for (const key of SERVICE_KEYS) {
    const value = String(fd.get(`item_${key}`) ?? "").trim();
    if (value) itemMap[key] = value;
  }
  const items = await supabase.from("qbo_connection").update({ item_map: itemMap }).eq("singleton", true);
  if (items.error) done("error", items.error.message);

  const chosen = [...fd.entries()].filter(([k]) => k.startsWith("customer_")).map(([k, v]) => [k.slice(9), String(v).trim()] as const);
  const used = chosen.map(([, v]) => v).filter(Boolean);
  if (new Set(used).size !== used.length) done("error", "Two properties are set to the same QuickBooks customer. Each property needs its own.");
  // Clear first, so swapping two properties never trips the one-customer-per-property rule.
  for (const [accountId] of chosen) {
    const cleared = await supabase.from("billing_accounts").update({ qbo_customer_id: null }).eq("id", accountId);
    if (cleared.error) done("error", cleared.error.message);
  }
  for (const [accountId, customerId] of chosen) {
    if (!customerId) continue;
    const saved = await supabase.from("billing_accounts").update({ qbo_customer_id: customerId }).eq("id", accountId);
    if (saved.error) done("error", saved.error.message);
  }
  done("saved", "Links saved.");
}

/** Posts every approved invoice that is not in QuickBooks yet. Safe to click twice. */
export async function postAll() {
  const { supabase } = await requireAdmin();
  const qbo = await connect(supabase);
  if ("error" in qbo) done("error", qbo.error);
  const { data, error } = await supabase.from("invoices").select("id").in("status", ["approved", "sent", "partially_paid", "paid"]).is("qbo_invoice_id", null).eq("origin", "app").order("invoice_number");
  if (error) done("error", error.message);
  const problems: string[] = [];
  let posted = 0;
  for (const row of data ?? []) {
    const problem = await pushInvoice(supabase, row.id, qbo as Exclude<typeof qbo, { error: string }>);
    if (problem) problems.push(problem);
    else posted += 1;
  }
  if (problems.length) done("error", `${posted} posted. ${problems.length} did not: ${problems.slice(0, 3).join(" ")}`);
  done("saved", posted ? `${posted} invoice${posted === 1 ? "" : "s"} posted to QuickBooks.` : "Nothing to post: every approved invoice is already in QuickBooks.");
}

export async function postOne(fd: FormData) {
  const { supabase } = await requireAdmin();
  const id = String(fd.get("invoice_id") ?? "");
  const problem = await pushInvoice(supabase, id);
  revalidatePath(`/invoices/${id}`);
  redirect(`/invoices/${id}?${problem ? "error" : "saved"}=${encodeURIComponent(problem ?? "Posted to QuickBooks.")}`);
}

export async function disconnect() {
  const { supabase } = await requireAdmin();
  const { error } = await supabase.from("qbo_connection").delete().eq("singleton", true);
  if (error) done("error", error.message);
  done("saved", "QuickBooks disconnected. Nothing in QuickBooks was changed, and the property links are kept.");
}

/** Brings in every invoice still open in QuickBooks for a linked property. Safe to click twice. */
export async function importOpen() {
  const { supabase } = await requireAdmin();
  const qbo = await connect(supabase);
  if ("error" in qbo) done("error", qbo.error);
  const result = await importOpenInvoices(supabase, qbo as Exclude<typeof qbo, { error: string }>);
  if ("error" in result) done("error", result.error);
  const r = result as Exclude<typeof result, { error: string }>;
  revalidatePath("/", "layout");
  const parts = [
    `${r.added} invoice${r.added === 1 ? "" : "s"} brought in, adding $${(r.addedCents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })} to what is owed.`,
    r.alreadyHere ? `${r.alreadyHere} were already here and left alone.` : "",
    r.skipped.length ? `Not brought in, because the customer is not linked to a property: ${r.skipped.join("; ")}.` : "",
    r.problems.length ? `Problems: ${r.problems.join("; ")}.` : "",
  ].filter(Boolean);
  done(r.problems.length ? "error" : "saved", parts.join(" "));
}

/** Runs the daily QuickBooks check right now: new invoices in, payments recorded. */
export async function checkNow() {
  const { supabase } = await requireAdmin();
  const qbo = await connect(supabase);
  if ("error" in qbo) done("error", qbo.error);
  const result = await syncFromQuickBooks(supabase, qbo as Exclude<typeof qbo, { error: string }>);
  if ("error" in result) done("error", result.error);
  const r = result as Exclude<typeof result, { error: string }>;
  revalidatePath("/", "layout");
  done(r.problems.length ? "error" : "saved", syncNote(r));
}
