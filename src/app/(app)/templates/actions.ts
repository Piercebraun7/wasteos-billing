"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { BLOCKS, resolveOptions } from "@/lib/pdf/template";

const text = (fd: FormData, key: string) => String(fd.get(key) ?? "").trim();
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function done(kind: "saved" | "error", message: string): never {
  revalidatePath("/templates");
  redirect(`/templates?${kind}=${encodeURIComponent(message)}`);
}

/** Reads the ticked blocks and the note from a template form. */
function readOptions(fd: FormData) {
  const raw: Record<string, unknown> = { note: text(fd, "note") };
  for (const b of BLOCKS) raw[b.key] = fd.get(b.key) === "on";
  return resolveOptions(raw);
}

export async function saveTemplate(fd: FormData) {
  const { supabase } = await requireAdmin();
  const name = text(fd, "name");
  if (!name) done("error", "Give the template a name.");
  const { error } = await supabase.from("invoice_templates").update({ name, options: readOptions(fd) }).eq("id", text(fd, "template_id"));
  if (error) done("error", error.code === "23505" ? `There is already a template named ${name}.` : error.message);
  done("saved", `${name} saved. It applies to invoices approved from now on.`);
}

export async function addTemplate(fd: FormData) {
  const { supabase } = await requireAdmin();
  const name = text(fd, "name");
  if (!name) done("error", "Give the new template a name.");
  // A new template starts as a copy of the default, ready to adjust.
  const { data: base } = await supabase.from("invoice_templates").select("options").eq("is_default", true).maybeSingle();
  const { error } = await supabase.from("invoice_templates").insert({ name, options: resolveOptions(base?.options) });
  if (error) done("error", error.code === "23505" ? `There is already a template named ${name}.` : error.message);
  done("saved", `${name} added as a copy of the default. Adjust it below, then choose which properties use it.`);
}

export async function makeDefault(fd: FormData) {
  const { supabase } = await requireAdmin();
  const id = text(fd, "template_id");
  const cleared = await supabase.from("invoice_templates").update({ is_default: false }).eq("is_default", true);
  if (cleared.error) done("error", cleared.error.message);
  const { error } = await supabase.from("invoice_templates").update({ is_default: true }).eq("id", id);
  if (error) done("error", error.message);
  done("saved", "Default template changed. Every property without its own template now uses it.");
}

export async function removeTemplate(fd: FormData) {
  const { supabase } = await requireAdmin();
  const { error } = await supabase.from("invoice_templates").delete().eq("id", text(fd, "template_id")).eq("is_default", false);
  if (error) done("error", error.message);
  done("saved", "Template removed. Properties that used it are back on the default.");
}

export async function saveAssignment(fd: FormData) {
  const { supabase } = await requireAdmin();
  const template = text(fd, "invoice_template_id");
  const { error } = await supabase
    .from("billing_accounts")
    .update({ invoice_template_id: template || null, customer_reference: text(fd, "customer_reference") || null })
    .eq("id", text(fd, "account_id"));
  if (error) done("error", error.message);
  done("saved", "Saved.");
}

export async function saveCompanyDetails(fd: FormData) {
  const { supabase } = await requireAdmin();
  const email = text(fd, "company_email");
  const address = text(fd, "remittance_address");
  if (email && !EMAIL.test(email)) done("error", "The email does not look right.");
  if (!address) done("error", "Enter the address checks are mailed to.");
  const { error } = await supabase
    .from("app_settings")
    .update({ company_phone: text(fd, "company_phone") || null, company_email: email || null, remittance_address: address, ach_instructions: text(fd, "ach_instructions") || null })
    .eq("singleton", true);
  if (error) done("error", error.message);
  done("saved", "Payment and contact details saved.");
}
