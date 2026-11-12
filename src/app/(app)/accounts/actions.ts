"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { todayInPhoenix } from "@/lib/billing/dates";
import { draftLoggedWork } from "@/lib/billing/drafts";
import { formatDate, usesPhases } from "@/lib/format";
import { parseDollarsToCents, parsePercentToBps } from "@/lib/money";

const text = (fd: FormData, key: string) => String(fd.get(key) ?? "").trim();
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function wholeNumber(value: string): number | null {
  return /^\d+$/.test(value) ? Number(value) : null;
}

type PhaseInput = {
  label: string;
  effective_start: string;
  billable_units: string;
  rate_per_unit_cents: string;
  flat_amount_cents: string;
};

/** Checks one phase row. Returns the cleaned row, or a message saying what is wrong. */
function readPhase(
  model: string,
  label: string,
  start: string,
  units: string,
  rate: string,
  flat: string,
): PhaseInput | string {
  if (!label) return "Each phase needs a label, for example Full rate.";
  if (!DATE.test(start)) return `Phase "${label}" needs a start date.`;
  if (model === "per_unit_valet") {
    const u = wholeNumber(units);
    const r = parseDollarsToCents(rate);
    if (u === null) return `Phase "${label}" needs a whole number of billable units.`;
    if (r === null) return `Phase "${label}" needs a rate per unit, for example 12.50. Use 0 for a free month.`;
    return { label, effective_start: start, billable_units: String(u), rate_per_unit_cents: String(r), flat_amount_cents: "" };
  }
  const f = parseDollarsToCents(flat);
  if (f === null) return `Phase "${label}" needs a monthly amount, for example 1500.00. Use 0 for a free month.`;
  return { label, effective_start: start, billable_units: "", rate_per_unit_cents: "", flat_amount_cents: String(f) };
}

function readContract(fd: FormData): Record<string, string | boolean> | string {
  const model = text(fd, "billing_model");
  if (!model) return "Choose a billing model.";
  const netDays = text(fd, "net_days");
  if (netDays && wholeNumber(netDays) === null) return "Net days must be a whole number, for example 30.";
  const start = text(fd, "start_date");
  const end = text(fd, "end_date");
  if (start && !DATE.test(start)) return "The contract start date is not a valid date.";
  if (end && !DATE.test(end)) return "The contract end date is not a valid date.";
  if (start && end && end < start) return "The contract end date is before its start date.";
  const rebate = text(fd, "rebate_percent");
  const rebateBps = rebate ? parsePercentToBps(rebate) : 0;
  if (rebateBps === null) return "Rebate percent must be a number, for example 3.";
  const notion = text(fd, "notion_url");
  if (notion && !/^https:\/\//.test(notion)) return "The Notion link must start with https://";
  return {
    billing_model: model,
    quoted_basis: text(fd, "quoted_basis"),
    net_days: netDays,
    start_date: start,
    end_date: end,
    preferred_agreement: fd.get("preferred_agreement") === "on",
    rebate_bps: String(rebateBps),
    notion_url: notion,
  };
}

export type FormResult = { error: string } | undefined;

export async function createAccount(fd: FormData): Promise<FormResult> {
  const { supabase } = await requireAdmin();

  const customerId = text(fd, "customer_id");
  const customerName = text(fd, "customer_name");
  if (!customerId && !customerName) return { error: "Choose an existing client or type a new client name." };

  const propertyName = text(fd, "property_name");
  if (!propertyName) return { error: "Enter the property name." };
  const unitCount = text(fd, "unit_count");
  if (unitCount && wholeNumber(unitCount) === null) return { error: "Unit count must be a whole number." };

  const contract = readContract(fd);
  if (typeof contract === "string") return { error: contract };
  const model = contract.billing_model as string;

  const contacts: { name: string; email: string; role: string }[] = [];
  const names = fd.getAll("contact_name").map(String);
  const emails = fd.getAll("contact_email").map(String);
  const roles = fd.getAll("contact_role").map(String);
  for (let i = 0; i < names.length; i++) {
    const name = names[i].trim();
    const email = (emails[i] ?? "").trim();
    if (!name && !email) continue;
    if (!name) return { error: `Add a name for the contact ${email}.` };
    if (!EMAIL.test(email)) return { error: `The email for ${name} does not look right.` };
    contacts.push({ name, email, role: (roles[i] ?? "").trim() });
  }

  const phases: PhaseInput[] = [];
  if (usesPhases(model)) {
    const labels = fd.getAll("phase_label").map(String);
    const starts = fd.getAll("phase_start").map(String);
    const units = fd.getAll("phase_units").map(String);
    const rates = fd.getAll("phase_rate").map(String);
    const flats = fd.getAll("phase_flat").map(String);
    for (let i = 0; i < labels.length; i++) {
      const row = [labels[i], starts[i], units[i], rates[i], flats[i]].map((v) => (v ?? "").trim());
      if (row.every((v) => !v)) continue;
      const phase = readPhase(model, row[0], row[1], row[2], row[3], row[4]);
      if (typeof phase === "string") return { error: phase };
      phases.push(phase);
    }
  }

  const ownerChoice = text(fd, "owner_entity_id");
  const { data, error } = await supabase.rpc("create_billing_account", {
    p: {
      customer_id: customerId,
      customer_name: customerName,
      owner_entity_id: ownerChoice === "new" ? "" : ownerChoice,
      owner_legal_name: ownerChoice === "new" ? text(fd, "owner_legal_name") : "",
      property: {
        name: propertyName,
        address_line1: text(fd, "address_line1"),
        address_line2: text(fd, "address_line2"),
        city: text(fd, "city"),
        state: text(fd, "state"),
        postal_code: text(fd, "postal_code"),
        unit_count: unitCount,
      },
      contacts,
      contract,
      phases,
    },
  });
  if (error) return { error: `The account was not saved: ${error.message}` };

  revalidatePath("/accounts");
  revalidatePath("/schedule");
  if (text(fd, "next") === "schedule") {
    redirect(`/schedule/${data}?saved=${encodeURIComponent("Property created. Upload its signed contract to build the schedule.")}`);
  }
  redirect(`/accounts/${data}?saved=${encodeURIComponent("Property created.")}`);
}

// ---------------------------------------------------------------------------
// Editing from the account page. Each action saves one section, then returns
// to the page with a short message.
// ---------------------------------------------------------------------------

/** Returns to the property page, or to the Contacts page when the form was submitted from there. */
function back(accountId: string, kind: "saved" | "error", message: string, returnTo = ""): never {
  revalidatePath(`/accounts/${accountId}`);
  revalidatePath("/accounts");
  revalidatePath("/contacts");
  const base = returnTo === "contacts" ? "/contacts" : `/accounts/${accountId}`;
  redirect(`${base}?${kind}=${encodeURIComponent(message)}`);
}

export async function updateProperty(fd: FormData) {
  const { supabase } = await requireAdmin();
  const accountId = text(fd, "account_id");
  const name = text(fd, "name");
  const unitCount = text(fd, "unit_count");
  if (!name) back(accountId, "error", "Enter the property name.");
  if (unitCount && wholeNumber(unitCount) === null) back(accountId, "error", "Unit count must be a whole number.");
  const { error } = await supabase
    .from("properties")
    .update({
      name,
      address_line1: text(fd, "address_line1") || null,
      address_line2: text(fd, "address_line2") || null,
      city: text(fd, "city") || null,
      state: text(fd, "state") || null,
      postal_code: text(fd, "postal_code") || null,
      unit_count: unitCount ? Number(unitCount) : null,
    })
    .eq("id", text(fd, "property_id"));
  if (error) back(accountId, "error", error.message);
  back(accountId, "saved", "Property saved.");
}

export async function updateBillTo(fd: FormData) {
  const { supabase } = await requireAdmin();
  const accountId = text(fd, "account_id");
  const name = text(fd, "customer_name");
  if (!name) back(accountId, "error", "Enter the client name.");
  const { error } = await supabase
    .from("customers")
    .update({ name, is_ach_payer: fd.get("is_ach_payer") === "on" })
    .eq("id", text(fd, "customer_id"));
  if (error) back(accountId, "error", error.message);

  // Owner entity: keep, rename, create, or clear.
  const ownerId = text(fd, "owner_entity_id");
  const ownerName = text(fd, "owner_legal_name");
  if (ownerId && ownerName) {
    const res = await supabase.from("owner_entities").update({ legal_name: ownerName }).eq("id", ownerId);
    if (res.error) back(accountId, "error", res.error.message);
  } else if (ownerId && !ownerName) {
    const res = await supabase.from("billing_accounts").update({ owner_entity_id: null }).eq("id", accountId);
    if (res.error) back(accountId, "error", res.error.message);
  } else if (!ownerId && ownerName) {
    const created = await supabase.from("owner_entities").insert({ legal_name: ownerName }).select("id").single();
    if (created.error) back(accountId, "error", created.error.message);
    const res = await supabase.from("billing_accounts").update({ owner_entity_id: created.data.id }).eq("id", accountId);
    if (res.error) back(accountId, "error", res.error.message);
  }
  back(accountId, "saved", "Client details saved.");
}

export async function saveContact(fd: FormData) {
  const { supabase } = await requireAdmin();
  const accountId = text(fd, "account_id");
  const id = text(fd, "contact_id");
  const name = text(fd, "name");
  const email = text(fd, "email").toLowerCase();
  if (!name) back(accountId, "error", "Enter the contact's name.", text(fd, "return_to"));
  if (!EMAIL.test(email)) back(accountId, "error", `The email for ${name} does not look right.`, text(fd, "return_to"));
  // Anything a person types or saves counts as checked by them.
  const values = {
    name,
    email,
    role: text(fd, "role") || null,
    delivery: text(fd, "delivery") === "cc" ? "cc" : "to",
    confirmed_at: new Date().toISOString(),
  };
  // The same email is never added to one account twice.
  let duplicate = supabase.from("billing_contacts").select("id").eq("account_id", accountId).eq("email", email);
  if (id) duplicate = duplicate.neq("id", id);
  const existing = await duplicate.limit(1);
  if (existing.error) back(accountId, "error", existing.error.message, text(fd, "return_to"));
  if (existing.data?.length) back(accountId, "error", `${email} is already a contact on this account.`, text(fd, "return_to"));
  const { error } = id
    ? await supabase.from("billing_contacts").update(values).eq("id", id)
    : await supabase.from("billing_contacts").insert({ ...values, account_id: accountId });
  if (error) back(accountId, "error", error.message, text(fd, "return_to"));
  back(accountId, "saved", id ? "Contact saved." : "Contact added.", text(fd, "return_to"));
}

export async function removeContact(fd: FormData) {
  const { supabase } = await requireAdmin();
  const accountId = text(fd, "account_id");
  const { error } = await supabase.from("billing_contacts").delete().eq("id", text(fd, "contact_id"));
  if (error) back(accountId, "error", error.message, text(fd, "return_to"));
  back(accountId, "saved", "Contact removed.", text(fd, "return_to"));
}

export async function updateContract(fd: FormData) {
  const { supabase } = await requireAdmin();
  const accountId = text(fd, "account_id");
  const contract = readContract(fd);
  if (typeof contract === "string") back(accountId, "error", contract);
  const c = contract as Record<string, string | boolean>;
  const { error } = await supabase
    .from("contracts")
    .update({
      billing_model: c.billing_model,
      quoted_basis: c.quoted_basis || null,
      net_days: c.net_days ? Number(c.net_days) : 30,
      start_date: c.start_date || null,
      end_date: c.end_date || null,
      preferred_agreement: c.preferred_agreement,
      rebate_bps: Number(c.rebate_bps),
      notion_url: c.notion_url || null,
    })
    .eq("id", text(fd, "contract_id"));
  if (error) back(accountId, "error", error.message);
  back(accountId, "saved", "Contract terms saved.");
}

export async function savePhase(fd: FormData) {
  const { supabase } = await requireAdmin();
  const accountId = text(fd, "account_id");
  const id = text(fd, "phase_id");
  const phase = readPhase(
    text(fd, "billing_model"),
    text(fd, "label"),
    text(fd, "effective_start"),
    text(fd, "units"),
    text(fd, "rate"),
    text(fd, "flat"),
  );
  if (typeof phase === "string") back(accountId, "error", phase);
  const p = phase as PhaseInput;
  const values = {
    label: p.label,
    effective_start: p.effective_start,
    billable_units: p.billable_units ? Number(p.billable_units) : null,
    rate_per_unit_cents: p.rate_per_unit_cents ? Number(p.rate_per_unit_cents) : null,
    flat_amount_cents: p.flat_amount_cents ? Number(p.flat_amount_cents) : null,
  };
  const { error } = id
    ? await supabase.from("contract_phases").update(values).eq("id", id)
    : await supabase.from("contract_phases").insert({ ...values, contract_id: text(fd, "contract_id") });
  if (error) back(accountId, "error", error.message);
  back(accountId, "saved", id ? "Phase saved." : "Phase added.");
}

export async function removePhase(fd: FormData) {
  const { supabase } = await requireAdmin();
  const accountId = text(fd, "account_id");
  const { error } = await supabase.from("contract_phases").delete().eq("id", text(fd, "phase_id"));
  if (error) back(accountId, "error", error.message);
  back(accountId, "saved", "Phase removed.");
}

export async function addEventRate(fd: FormData) {
  const { supabase } = await requireAdmin();
  const accountId = text(fd, "account_id");
  const rate = parseDollarsToCents(text(fd, "rate"));
  if (!text(fd, "event_type")) back(accountId, "error", "Choose the type of work.");
  if (rate === null) back(accountId, "error", "Enter the rate, for example 75.00.");
  const { error } = await supabase.from("contract_event_rates").insert({
    contract_id: text(fd, "contract_id"),
    event_type: text(fd, "event_type"),
    time_window: text(fd, "time_window") || null,
    rate_cents: rate,
  });
  if (error) back(accountId, "error", error.message);
  back(accountId, "saved", "Rate added.");
}

export async function removeEventRate(fd: FormData) {
  const { supabase } = await requireAdmin();
  const accountId = text(fd, "account_id");
  const { error } = await supabase.from("contract_event_rates").delete().eq("id", text(fd, "rate_id"));
  if (error) back(accountId, "error", error.message);
  back(accountId, "saved", "Rate removed.");
}

export async function updateBillingSetup(fd: FormData) {
  const { supabase } = await requireAdmin();
  const accountId = text(fd, "account_id");
  const goLive = text(fd, "go_live_month"); // "2026-11" or empty
  if (goLive && !/^\d{4}-\d{2}$/.test(goLive)) back(accountId, "error", "Choose the go-live service month.");
  const active = fd.get("active") === "on";

  const account = await supabase
    .from("billing_accounts")
    .update({ go_live_service_month: goLive ? `${goLive}-01` : null })
    .eq("id", accountId);
  if (account.error) back(accountId, "error", account.error.message);

  const contract = await supabase
    .from("contracts")
    .update({ late_fee_template_id: text(fd, "late_fee_template_id") || null, status: active ? "active" : "draft" })
    .eq("id", text(fd, "contract_id"));
  if (contract.error) back(accountId, "error", contract.error.message);
  back(accountId, "saved", active ? "Saved. This account is active for billing." : "Saved. This account is not active for billing.");
}

export async function addBillableEvent(fd: FormData) {
  const { supabase } = await requireAdmin();
  const accountId = text(fd, "account_id");
  const date = text(fd, "event_date");
  const quantity = text(fd, "quantity") || "1";
  if (!DATE.test(date)) back(accountId, "error", "Choose the date the work was done.");
  if (!/^\d+(\.\d{1,2})?$/.test(quantity) || Number(quantity) <= 0) back(accountId, "error", "Quantity must be a number above zero.");
  const { error } = await supabase.from("billable_events").insert({
    account_id: accountId,
    event_date: date,
    event_type: text(fd, "event_type"),
    time_window: text(fd, "time_window") || null,
    quantity,
    description: text(fd, "description") || null,
    source_reference: "Entered by hand",
    status: "approved",
  });
  if (error) back(accountId, "error", error.message);
  // Work billed per job gets its own draft invoice, dated the day it was done.
  let run;
  try {
    run = await draftLoggedWork(supabase, accountId);
  } catch (e) {
    back(accountId, "error", `Work logged, but the draft could not be made: ${e instanceof Error ? e.message : "unknown error"}`);
  }
  revalidatePath("/review");
  if (run!.created.length > 0) back(accountId, "saved", `Work logged. A draft invoice dated ${formatDate(date)} is waiting in the review queue.`);
  back(accountId, "saved", run!.skipped[0]?.reason ? `Work logged. No draft yet: ${run!.skipped[0].reason}` : "Work logged. It will appear on the invoice for that month.");
}

export async function removeBillableEvent(fd: FormData) {
  const { supabase } = await requireAdmin();
  const accountId = text(fd, "account_id");
  const { error } = await supabase.from("billable_events").delete().eq("id", text(fd, "event_id")).neq("status", "invoiced");
  if (error) back(accountId, "error", error.message);
  back(accountId, "saved", "Logged work removed.");
}

/**
 * One switch for billing. Turning it on fills in any standard term that is
 * still empty (late fee terms, pre-tax basis, go-live month), then activates.
 */
export async function toggleBilling(fd: FormData) {
  const { supabase } = await requireAdmin();
  const accountId = text(fd, "account_id");
  const turnOn = text(fd, "turn") === "on";
  const returnTo = text(fd, "return_to");
  const done = (kind: "saved" | "error", message: string): never => {
    revalidatePath("/schedule");
    revalidatePath("/accounts");
    revalidatePath(`/accounts/${accountId}`);
    revalidatePath(`/schedule/${accountId}`);
    const base = returnTo.startsWith("/schedule") ? returnTo : `/accounts/${accountId}`;
    redirect(`${base}${base.includes("?") ? "&" : "?"}${kind}=${encodeURIComponent(message)}`);
  };

  const { data: account, error } = await supabase
    .from("billing_accounts")
    .select("go_live_service_month, property:properties(name), contracts(id, status, created_at, late_fee_template_id, quoted_basis, start_date)")
    .eq("id", accountId)
    .single();
  if (error) done("error", error.message);
  type C = { id: string; status: string; created_at: string; late_fee_template_id: string | null; quoted_basis: string | null; start_date: string | null };
  const contracts = (account!.contracts ?? []) as C[];
  const contract = contracts.find((c) => c.status === "active") ?? [...contracts].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  if (!contract) done("error", "This property has no contract yet.");
  const name = (account!.property as unknown as { name: string }).name;

  if (!turnOn) {
    const off = await supabase.from("contracts").update({ status: "draft" }).eq("account_id", accountId).eq("status", "active");
    if (off.error) done("error", off.error.message);
    done("saved", `Billing is off for ${name}. No invoice will be drafted for it.`);
  }

  const { data: templates } = await supabase.from("late_fee_templates").select("id, name").not("confirmed_at", "is", null).order("created_at");
  const standard = (templates ?? []).find((t) => t.name === "3% monthly") ?? (templates ?? [])[0];
  if (!standard) done("error", "There is no confirmed late fee template yet.");

  if (!account!.go_live_service_month) {
    // First month this app invoices: the current month, or the start month if service starts later.
    const current = `${todayInPhoenix().slice(0, 7)}-01`;
    const startMonth = contract.start_date ? `${contract.start_date.slice(0, 7)}-01` : current;
    const goLive = await supabase.from("billing_accounts").update({ go_live_service_month: startMonth > current ? startMonth : current }).eq("id", accountId);
    if (goLive.error) done("error", goLive.error.message);
  }
  // Every service on the property is switched on, each keeping any terms already set.
  for (const c of contracts.filter((c) => c.status !== "ended")) {
    const on = await supabase
      .from("contracts")
      .update({ status: "active", late_fee_template_id: c.late_fee_template_id ?? standard!.id, quoted_basis: c.quoted_basis ?? "pre_tax" })
      .eq("id", c.id);
    if (on.error) done("error", on.error.message);
  }
  done("saved", `Billing is on for ${name}.`);
}

/** Switches billing on for every property that is off. Terms are filled in the same way as the single switch. */
export async function turnOnAllBilling() {
  const { supabase } = await requireAdmin();
  const { data: templates } = await supabase.from("late_fee_templates").select("id, name").not("confirmed_at", "is", null).order("created_at");
  const standard = (templates ?? []).find((t) => t.name === "3% monthly") ?? (templates ?? [])[0];
  const fail = (message: string): never => redirect(`/schedule?error=${encodeURIComponent(message)}`);
  if (!standard) fail("There is no confirmed late fee template yet.");

  const { data: accounts, error } = await supabase
    .from("billing_accounts")
    .select("id, go_live_service_month, contracts(id, status, late_fee_template_id, quoted_basis, start_date)")
    .eq("status", "active");
  if (error) fail(error.message);
  const current = `${todayInPhoenix().slice(0, 7)}-01`;
  let switched = 0;
  for (const account of accounts ?? []) {
    const off = (account.contracts ?? []).filter((c) => c.status === "draft");
    if (off.length === 0) continue;
    if (!account.go_live_service_month) {
      const start = off[0].start_date ? `${String(off[0].start_date).slice(0, 7)}-01` : current;
      const res = await supabase.from("billing_accounts").update({ go_live_service_month: start > current ? start : current }).eq("id", account.id);
      if (res.error) fail(res.error.message);
    }
    for (const c of off) {
      const res = await supabase
        .from("contracts")
        .update({ status: "active", late_fee_template_id: c.late_fee_template_id ?? standard!.id, quoted_basis: c.quoted_basis ?? "pre_tax" })
        .eq("id", c.id);
      if (res.error) fail(res.error.message);
    }
    switched++;
  }
  revalidatePath("/schedule");
  revalidatePath("/accounts");
  redirect(`/schedule?saved=${encodeURIComponent(`Billing switched on for ${switched} propert${switched === 1 ? "y" : "ies"}.`)}`);
}

/** Marks every contact on a property as checked today. */
export async function confirmContacts(fd: FormData) {
  const { supabase, user } = await requireAdmin();
  const accountId = text(fd, "account_id");
  const { error } = await supabase
    .from("billing_contacts")
    .update({ confirmed_at: new Date().toISOString(), confirmed_by: user.id })
    .eq("account_id", accountId);
  if (error) back(accountId, "error", error.message, "contacts");
  back(accountId, "saved", "Contacts confirmed.", "contacts");
}

/** Adds bulk trash as its own service on a property: billed per load, on its own invoice. */
export async function addBulkService(fd: FormData) {
  const { supabase } = await requireAdmin();
  const accountId = text(fd, "account_id");
  const rate = parseDollarsToCents(text(fd, "rate"));
  const loads = text(fd, "loads") || "1";
  if (rate === null) back(accountId, "error", "Enter the price per load, for example 350.00.", "");
  if (!/^\d+(\.\d{1,2})?$/.test(loads)) back(accountId, "error", "Usual loads per month must be a number, for example 1 or 1.5.", "");

  const existing = await supabase.from("contracts").select("id, status, late_fee_template_id, quoted_basis, net_days").eq("account_id", accountId);
  if (existing.error) back(accountId, "error", existing.error.message, "");
  const others = existing.data ?? [];
  const on = others.some((c) => c.status === "active");
  const like = others.find((c) => c.late_fee_template_id) ?? others[0];
  const expected = Math.floor((2 * rate! * Math.round(Number(loads) * 100) + 100) / 200);
  const created = await supabase
    .from("contracts")
    .insert({
      account_id: accountId,
      billing_model: "per_event",
      service_category: "bulk",
      net_days: like?.net_days ?? 30,
      late_fee_template_id: like?.late_fee_template_id ?? null,
      quoted_basis: like?.quoted_basis ?? "pre_tax",
      expected_monthly_cents: expected,
      // Follows the property's switch, when its terms allow it.
      status: on && like?.late_fee_template_id ? "active" : "draft",
    })
    .select("id")
    .single();
  if (created.error) back(accountId, "error", created.error.message, "");
  const rateRow = await supabase.from("contract_event_rates").insert({ contract_id: created.data!.id, event_type: "bulk_pickup", rate_cents: rate, label: "Per full load" });
  if (rateRow.error) back(accountId, "error", rateRow.error.message, "");
  revalidatePath("/schedule");
  back(accountId, "saved", "Bulk trash added. Log each pickup under Logged work and it will be billed on its own invoice.", "");
}

/** Removes a property: deleted if it was never invoiced, archived if it has billing history. */
export async function removeProperty(fd: FormData) {
  const { supabase } = await requireAdmin();
  const accountId = text(fd, "account_id");
  const name = text(fd, "property_name");
  const { data, error } = await supabase.rpc("delete_billing_account", { p_account_id: accountId });
  if (error) back(accountId, "error", error.message);
  revalidatePath("/accounts");
  revalidatePath("/schedule");
  revalidatePath("/contacts");
  revalidatePath("/");
  const message =
    data === "archived"
      ? `${name} has billing history, so it was archived instead of deleted. Billing is off, and its invoices and balance are kept.`
      : `${name} was deleted.`;
  redirect(`/accounts?saved=${encodeURIComponent(message)}`);
}

/** Sets the property's normal price per load for bulk trash, and how many loads a usual month has. */
export async function updateBulkRate(fd: FormData) {
  const { supabase } = await requireAdmin();
  const accountId = text(fd, "account_id");
  const rate = parseDollarsToCents(text(fd, "rate"));
  const loads = text(fd, "loads") || "1";
  if (rate === null) back(accountId, "error", "Enter the normal price per load, for example 350.00.");
  if (!/^\d+(\.\d{1,2})?$/.test(loads)) back(accountId, "error", "Usual loads per month must be a number, for example 1 or 1.5.");
  const { error } = await supabase.from("contract_event_rates").update({ rate_cents: rate }).eq("id", text(fd, "rate_id"));
  if (error) back(accountId, "error", error.message);
  const expected = Math.floor((2 * rate! * Math.round(Number(loads) * 100) + 100) / 200);
  const usual = await supabase.from("contracts").update({ expected_monthly_cents: expected }).eq("id", text(fd, "contract_id"));
  if (usual.error) back(accountId, "error", usual.error.message);
  revalidatePath("/schedule");
  revalidatePath("/bulk");
  back(accountId, "saved", "Saved. The bulk run and new bulk invoices for this property start from these.");
}

/** Bills bulk trash every month on a chosen day, at the property's normal price. */
export async function addMonthlyBulk(fd: FormData) {
  const { supabase } = await requireAdmin();
  const accountId = text(fd, "account_id");
  const rate = parseDollarsToCents(text(fd, "rate"));
  const loads = text(fd, "loads") || "1";
  const day = Number(text(fd, "day"));
  if (rate === null) back(accountId, "error", "Enter the price per load, for example 350.00.");
  if (!/^\d+(\.\d{1,2})?$/.test(loads) || Number(loads) <= 0) back(accountId, "error", "Loads must be a number above zero, for example 1 or 1.5.");
  if (!Number.isInteger(day) || day < 1 || day > 28) back(accountId, "error", "Choose a day of the month from 1 to 28.");
  const item = await supabase.from("service_items").select("id, name").eq("name", "Scheduled Bulk Waste Service").maybeSingle();
  const current = `${todayInPhoenix().slice(0, 7)}-01`;
  const { error } = await supabase.from("recurring_invoices").insert({
    account_id: accountId,
    name: "Monthly bulk trash",
    service_category: "bulk",
    day_of_month: day,
    start_month: current,
    lines: [{ service_item_id: item.data?.id ?? null, description: "Scheduled Bulk Waste Service", quantity: loads, unit_price_cents: rate }],
  });
  if (error) back(accountId, "error", error.message);
  revalidatePath("/schedule");
  back(accountId, "saved", `Bulk trash will be drafted on day ${day} of every month. Change the loads on the draft in the review queue if a month is different.`);
}

export async function setRecurringStatus(fd: FormData) {
  const { supabase } = await requireAdmin();
  const accountId = text(fd, "account_id");
  const pause = text(fd, "to") === "paused";
  const { error } = await supabase.from("recurring_invoices").update({ status: pause ? "paused" : "active" }).eq("id", text(fd, "recurring_id"));
  if (error) back(accountId, "error", error.message);
  revalidatePath("/schedule");
  back(accountId, "saved", pause ? "Paused. No new drafts will be made from it." : "Resumed.");
}

export async function removeRecurring(fd: FormData) {
  const { supabase } = await requireAdmin();
  const accountId = text(fd, "account_id");
  const id = text(fd, "recurring_id");
  const used = await supabase.from("invoices").select("id").eq("recurring_invoice_id", id).limit(1);
  if (used.data?.length) {
    // Invoices already made from it keep pointing at it, so it is paused instead of deleted.
    const paused = await supabase.from("recurring_invoices").update({ status: "paused" }).eq("id", id);
    if (paused.error) back(accountId, "error", paused.error.message);
    revalidatePath("/schedule");
    back(accountId, "saved", "It has already produced invoices, so it was paused instead of deleted. No new drafts will be made.");
  }
  const { error } = await supabase.from("recurring_invoices").delete().eq("id", id);
  if (error) back(accountId, "error", error.message);
  revalidatePath("/schedule");
  back(accountId, "saved", "Recurring invoice removed.");
}
