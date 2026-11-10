"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { extractText, getDocumentProxy } from "unpdf";
import { requireAdmin } from "@/lib/auth";
import { parseContractText, type ScrapedTerms } from "@/lib/contracts/parse";
import { flatPhase, rampPhases, termEnd, type Alignment } from "@/lib/contracts/ramp";
import { parseDollarsToCents } from "@/lib/money";

const text = (fd: FormData, key: string) => String(fd.get(key) ?? "").trim();

function back(accountId: string, kind: "saved" | "error", message: string): never {
  revalidatePath(`/schedule/${accountId}`);
  revalidatePath("/schedule");
  revalidatePath(`/accounts/${accountId}`);
  redirect(`/schedule/${accountId}?${kind}=${encodeURIComponent(message)}`);
}

/** Stores the signed contract privately and reads its basic terms for review. Nothing is applied yet. */
export async function uploadContract(fd: FormData) {
  const { supabase } = await requireAdmin();
  const accountId = text(fd, "account_id");
  const contractId = text(fd, "contract_id");
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) back(accountId, "error", "Choose the signed contract PDF first.");
  const pdf = file as File;
  if (pdf.type !== "application/pdf" && !pdf.name.toLowerCase().endsWith(".pdf")) back(accountId, "error", "The contract must be a PDF file.");
  if (pdf.size > 15 * 1024 * 1024) back(accountId, "error", "That file is larger than 15 MB.");

  const bytes = new Uint8Array(await pdf.arrayBuffer());
  let terms: ScrapedTerms | null = null;
  try {
    // A copy, because the PDF reader takes ownership of the bytes it is given.
    const document = await getDocumentProxy(bytes.slice());
    const { text: content } = await extractText(document, { mergePages: true });
    terms = parseContractText(content);
  } catch {
    terms = null;
  }

  const safeName = pdf.name.replace(/[^\w. ()-]+/g, " ").trim() || "Contract.pdf";
  const path = `${accountId}/${Date.now()} ${safeName}`;
  const upload = await supabase.storage.from("contracts").upload(path, bytes, { contentType: "application/pdf", upsert: false });
  if (upload.error) back(accountId, "error", `The contract could not be stored: ${upload.error.message}`);

  const { error } = await supabase
    .from("contracts")
    .update({ contract_file_path: path, contract_file_name: safeName, scraped_terms: terms })
    .eq("id", contractId);
  if (error) back(accountId, "error", error.message);

  if (!terms || terms.kind === "unknown") {
    back(accountId, "error", "The contract is stored, but its terms could not be read automatically. It may be a scanned image. Enter the schedule by hand on the property page.");
  }
  back(accountId, "saved", "Contract stored and read. Check what it says below before building the schedule.");
}

/** Replaces the property's phases with the schedule built from the contract. */
export async function applySchedule(fd: FormData) {
  const { supabase } = await requireAdmin();
  const accountId = text(fd, "account_id");
  const contractId = text(fd, "contract_id");
  const start = text(fd, "start");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) back(accountId, "error", "Choose the service start date.");

  const { data: contract, error } = await supabase.from("contracts").select("billing_model, scraped_terms").eq("id", contractId).single();
  if (error) back(accountId, "error", error.message);
  const terms = contract!.scraped_terms as ScrapedTerms | null;
  if (!terms) back(accountId, "error", "Upload the signed contract first.");
  const model = contract!.billing_model as string;

  let phases;
  if (model === "per_unit_valet") {
    const units = text(fd, "units");
    const rate = parseDollarsToCents(text(fd, "rate"));
    if (!/^\d+$/.test(units) || Number(units) === 0) back(accountId, "error", "Enter the full unit count.");
    if (rate === null) back(accountId, "error", "Enter the rate per unit, for example 12.50.");
    const align: Alignment = text(fd, "align") === "anniversary" ? "anniversary" : "calendar";
    phases = rampPhases({ steps: terms!.ramp, start, align, fullUnits: Number(units), rateCents: rate! });
  } else if (model === "flat_monthly" || model === "trash_room") {
    const monthly = parseDollarsToCents(text(fd, "monthly"));
    if (monthly === null) back(accountId, "error", "Enter the monthly amount, for example 2100.00.");
    phases = flatPhase(start, monthly!);
  } else {
    back(accountId, "error", "This billing model has no monthly schedule. Its charges come from logged work.");
  }

  const saved = await supabase.rpc("replace_contract_phases", { p_contract_id: contractId, p_phases: phases });
  if (saved.error) back(accountId, "error", saved.error.message);

  const dates = await supabase
    .from("contracts")
    .update({ start_date: start, ...(terms!.termYears ? { end_date: termEnd(start, terms!.termYears) } : {}) })
    .eq("id", contractId);
  if (dates.error) back(accountId, "error", dates.error.message);
  back(accountId, "saved", `Schedule saved: ${phases!.length} phase${phases!.length === 1 ? "" : "s"}.`);
}
