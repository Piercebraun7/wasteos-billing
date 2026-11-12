"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { draftLoggedWork } from "@/lib/billing/drafts";
import { parseDollarsToCents } from "@/lib/money";

function back(month: string, kind: "saved" | "error", message: string): never {
  revalidatePath("/bulk");
  revalidatePath("/review");
  revalidatePath("/schedule");
  redirect(`/bulk?month=${month}&${kind}=${encodeURIComponent(message)}`);
}

/**
 * Saves the month's bulk pickups: one row per property with the day we were
 * there, how many loads, and the price. Each becomes a draft invoice dated
 * that day, waiting in the bulk review queue.
 */
export async function saveBulkRun(fd: FormData) {
  const { supabase } = await requireAdmin();
  const month = String(fd.get("month") ?? "");
  const accounts = fd.getAll("account_id").map(String);
  const dates = fd.getAll("date").map(String);
  const loads = fd.getAll("loads").map((v) => String(v).trim());
  const prices = fd.getAll("price").map((v) => String(v).trim());
  const names = fd.getAll("property_name").map(String);

  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < accounts.length; i++) {
    if (!loads[i] || Number(loads[i]) === 0) continue; // Left empty: no pickup this month.
    if (!/^\d+(\.\d{1,2})?$/.test(loads[i])) back(month, "error", `${names[i]}: loads must be a number, for example 1 or 1.5.`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dates[i]) || dates[i].slice(0, 7) !== month) back(month, "error", `${names[i]}: choose a pickup date in this month.`);
    const price = parseDollarsToCents(prices[i]);
    if (price === null) back(month, "error", `${names[i]}: enter the price per load, for example 350.00.`);
    rows.push({
      account_id: accounts[i],
      event_date: dates[i],
      event_type: "bulk_pickup",
      quantity: loads[i],
      rate_cents: price,
      source_reference: "Bulk run",
      status: "approved",
    });
  }
  if (rows.length === 0) back(month, "error", "Enter the loads for at least one property.");

  const { error } = await supabase.from("billable_events").insert(rows);
  if (error) back(month, "error", error.message);

  let run;
  try {
    run = await draftLoggedWork(supabase);
  } catch (e) {
    back(month, "error", `The pickups were saved, but drafts could not be made: ${e instanceof Error ? e.message : "unknown error"}`);
  }
  const held = run!.skipped.map((s) => `${s.property}: ${s.reason}`).join(" ");
  back(
    month,
    run!.created.length ? "saved" : "error",
    `${rows.length} pickup${rows.length === 1 ? "" : "s"} saved, ${run!.created.length} draft invoice${run!.created.length === 1 ? "" : "s"} waiting in the bulk review queue.${held ? ` Not drafted: ${held}` : ""}`,
  );
}

/** Removes a pickup that has not been approved yet, along with its draft. */
export async function removePickup(fd: FormData) {
  const { supabase } = await requireAdmin();
  const month = String(fd.get("month") ?? "");
  const eventId = String(fd.get("event_id") ?? "");
  const drafts = await supabase.from("invoice_lines").select("invoice_id, invoice:invoices!invoice_lines_invoice_id_fkey(status)").eq("billable_event_id", eventId);
  for (const line of drafts.data ?? []) {
    const status = (line.invoice as unknown as { status: string } | null)?.status;
    if (status && status !== "draft") back(month, "error", "This pickup is on an approved invoice, so it cannot be removed. Use a credit memo instead.");
    const rejected = await supabase.rpc("reject_draft", { p_invoice_id: line.invoice_id });
    if (rejected.error) back(month, "error", rejected.error.message);
  }
  const { error } = await supabase.from("billable_events").delete().eq("id", eventId);
  if (error) back(month, "error", error.message);
  back(month, "saved", "Pickup removed.");
}
