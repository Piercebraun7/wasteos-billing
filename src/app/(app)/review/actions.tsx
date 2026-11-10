"use server";

import { renderToBuffer } from "@react-pdf/renderer";
import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { monthLabel } from "@/lib/billing/dates";
import { generateDrafts } from "@/lib/billing/drafts";
import { parseDollarsToCents } from "@/lib/money";
import { buildInvoiceDocument, pdfPath } from "@/lib/pdf/build";
import { InvoicePdf } from "@/lib/pdf/invoice-pdf";

const text = (fd: FormData, key: string) => String(fd.get(key) ?? "").trim();

function back(kind: "saved" | "error", message: string, to = "/review"): never {
  revalidatePath("/review");
  revalidatePath("/accounts");
  revalidatePath("/");
  redirect(`${to}?${kind}=${encodeURIComponent(message)}`);
}

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

/** Approves one draft, then stores its PDF exactly as issued. Returns an error message, or null. */
async function approveOne(supabase: SupabaseClient, invoiceId: string): Promise<string | null> {
  const { error } = await supabase.rpc("approve_invoice", { p_invoice_id: invoiceId });
  if (error) return error.message;
  try {
    const doc = await buildInvoiceDocument(supabase, invoiceId);
    const { data: invoice } = await supabase.from("invoices").select("account_id").eq("id", invoiceId).single();
    if (doc && invoice) {
      const buffer = await renderToBuffer(<InvoicePdf doc={doc} />);
      const upload = await supabase.storage
        .from("invoices")
        .upload(pdfPath(invoice.account_id, invoiceId), buffer, { contentType: "application/pdf", upsert: false });
      if (upload.error) return `Approved, but the PDF could not be stored: ${upload.error.message}`;
    }
  } catch (e) {
    return `Approved, but the PDF could not be stored: ${e instanceof Error ? e.message : "unknown error"}`;
  }
  return null;
}

export async function approveInvoice(fd: FormData) {
  const { supabase } = await requireAdmin();
  const id = text(fd, "invoice_id");
  const problem = await approveOne(supabase, id);
  if (problem) back("error", problem);
  back("saved", "Invoice approved and posted to the account.", `/invoices/${id}`);
}

export async function approveAll() {
  const { supabase } = await requireAdmin();
  const { data, error } = await supabase.from("invoices").select("id").eq("status", "draft").order("created_at");
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
  const { error } = await supabase.rpc("reject_draft", { p_invoice_id: text(fd, "invoice_id") });
  if (error) back("error", error.message);
  back("saved", "Draft rejected and removed. Generate drafts again to rebuild it from the contract.");
}

export async function updateDraftLine(fd: FormData) {
  const { supabase } = await requireAdmin();
  const invoiceId = text(fd, "invoice_id");
  const description = text(fd, "description");
  const amount = parseDollarsToCents(text(fd, "amount"));
  if (!description) back("error", "A line needs a description.");
  if (amount === null) back("error", "Enter the line amount, for example 1862.50.");
  const { error } = await supabase
    .from("invoice_lines")
    .update({ description, amount_cents: amount })
    .eq("id", text(fd, "line_id"))
    .eq("invoice_id", invoiceId);
  if (error) back("error", error.message);
  const recalc = await supabase.rpc("recalculate_draft", { p_invoice_id: invoiceId });
  if (recalc.error) back("error", recalc.error.message);
  back("saved", "Line updated.");
}
