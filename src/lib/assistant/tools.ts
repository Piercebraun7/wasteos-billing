import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { loadActivity, monthlyCents, type AccountContract } from "../billing/account-data";
import { accountStats } from "../billing/account-stats";
import { addDays, monthEnd, monthLabel, monthStart } from "../billing/dates";
import { generateDrafts } from "../billing/drafts";
import { billingPhases } from "../billing/escalation";
import { mayInvoice, recurringLines, type Phase } from "../billing/invoice-math";
import { formatCents, lineAmountCents, parseSignedDollarsToCents } from "../money";
import { isServiceCategory } from "../services";
import { matchProperty } from "./match";

type Account = {
  id: string; status: string; go_live_service_month: string | null;
  property: { name: string; unit_count: number | null }; customer: { name: string };
  contracts: (AccountContract & { net_days?: number })[]; contacts: { name: string; email: string; delivery: string; is_active: boolean }[];
};
const ACCOUNT_COLUMNS = "id, status, go_live_service_month, property:properties(name, unit_count), customer:customers(name), contacts:billing_contacts(name, email, delivery, is_active), contracts(status, billing_model, service_category, expected_monthly_cents, start_date, escalation_bps, net_days, phases:contract_phases(*), increases:rate_increases(*))";
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const json = (value: unknown) => JSON.stringify(value);

/**
 * What the assistant can do. Every tool runs as the signed-in person, so it
 * sees exactly what they can see. It can look things up and prepare a draft
 * invoice. It has no tool to approve, send, void, credit, or change a rate.
 */
export function assistantTools(supabase: SupabaseClient, today: string) {
  const month = `${today.slice(0, 7)}-01`;
  const accounts = async () => {
    const { data, error } = await supabase.from("billing_accounts").select(ACCOUNT_COLUMNS).eq("status", "active");
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Account[];
  };
  const find = async (name: string) => {
    const all = await accounts();
    const { match, candidates } = matchProperty(name, all.map((a) => ({ name: a.property.name, account: a })));
    if (match) return { account: match.account };
    return { problem: candidates.length ? `More than one property matches "${name}": ${candidates.map((c) => c.name).join("; ")}. Ask which one.` : `No property matches "${name}". Properties: ${all.map((a) => a.property.name).sort().join("; ")}.` };
  };

  const listAccounts = betaZodTool({
    name: "list_accounts",
    description: "Every active property with what it owes now, how much of that is overdue, what it is billed in a normal month, its last payment, whether billing is switched on, and whether it has someone to email. Call this for questions across properties: who owes the most, who is overdue, totals, who has no contact.",
    inputSchema: z.object({}),
    run: async () => {
      const [all, activity] = await Promise.all([accounts(), loadActivity(supabase)]);
      if ("error" in activity) return `Could not load invoices: ${activity.error}`;
      const rows = all.map((a) => {
        const s = accountStats(activity.invoices.filter((i) => i.account_id === a.id), activity.payments.filter((p) => p.account_id === a.id), activity.credits.filter((c) => c.account_id === a.id), today);
        return {
          property: a.property.name, management_company: a.customer.name, owes: formatCents(s.outstandingCents), overdue: formatCents(s.overdueCents),
          normal_month: formatCents(monthlyCents(a.contracts, month)), last_payment: s.lastPayment ? `${formatCents(s.lastPayment.amountCents)} on ${s.lastPayment.date}` : "none",
          billing_on: a.contracts.some((c) => c.status === "active"), has_to_contact: a.contacts.some((c) => c.is_active && c.delivery !== "cc"),
          _owes_cents: s.outstandingCents,
        };
      }).sort((x, y) => y._owes_cents - x._owes_cents);
      const total = rows.reduce((sum, r) => sum + r._owes_cents, 0);
      return json({ as_of: today, total_owed: formatCents(total), properties: rows.map(({ _owes_cents, ...r }) => { void _owes_cents; return r; }) });
    },
  });

  const getAccount = betaZodTool({
    name: "get_account",
    description: "Everything about one property: what it owes and why, overdue amount, billed and paid in the last 12 months, share paid on time, last payment, its services and monthly amounts, who receives its invoices, and its 40 most recent invoices with status and amount still owed.",
    inputSchema: z.object({ property: z.string().describe("The property name, or part of it, for example 'Liberty Farms'") }),
    run: async ({ property }) => {
      const found = await find(property);
      if ("problem" in found) return found.problem!;
      const a = found.account!;
      const activity = await loadActivity(supabase, a.id);
      if ("error" in activity) return `Could not load invoices: ${activity.error}`;
      const s = accountStats(activity.invoices, activity.payments, activity.credits, today);
      return json({
        property: a.property.name, management_company: a.customer.name, units: a.property.unit_count, page: `/customers/${a.id}`,
        owes: formatCents(s.outstandingCents), overdue: formatCents(s.overdueCents),
        owed_by_service: Object.fromEntries(Object.entries(s.openByService).map(([k, v]) => [k, formatCents(v)])),
        billed_last_12_months: formatCents(s.billed12Cents), paid_last_12_months: formatCents(s.paid12Cents),
        paid_on_time: s.onTimePercent === null ? "no history yet" : `${s.onTimePercent}% of ${s.paidInFull} invoices paid in full`,
        last_payment: s.lastPayment ? `${formatCents(s.lastPayment.amountCents)} on ${s.lastPayment.date}` : "none",
        normal_month: formatCents(monthlyCents(a.contracts, month)),
        services: a.contracts.filter((c) => c.status !== "ended").map((c) => ({ service: c.service_category, billing: c.status === "active" ? "on" : "off", net_days: c.net_days ?? 30 })),
        first_month_billed_here: a.go_live_service_month,
        contacts: a.contacts.filter((c) => c.is_active).map((c) => ({ line: c.delivery === "cc" ? "CC" : "To", name: c.name, email: c.email })),
        invoices: s.invoices.slice(0, 40).map((i) => ({ number: i.invoice_number, service: i.service_category, dated: i.invoice_date, due: i.due_date, amount: formatCents(i.total_cents), still_owed: formatCents(i.openCents), status: i.state, page: `/invoices/${i.id}` })),
      });
    },
  });

  const findInvoices = betaZodTool({
    name: "find_invoices",
    description: "Lists invoices across all properties, filtered by status. Use for: what is unpaid, what is overdue, what was paid, what drafts are waiting, what is approved but not sent. Drafts have no number yet.",
    inputSchema: z.object({
      status: z.enum(["unpaid", "overdue", "paid", "draft", "ready_to_send", "all"]).describe("unpaid = any amount still owed; ready_to_send = approved and not emailed yet"),
      property: z.string().optional().describe("Limit to one property, by name or part of it"),
      dated_from: z.string().optional().describe("Only invoices dated on or after this day, YYYY-MM-DD"),
      dated_to: z.string().optional().describe("Only invoices dated on or before this day, YYYY-MM-DD"),
    }),
    run: async ({ status, property, dated_from, dated_to }) => {
      let accountId: string | undefined;
      if (property) {
        const found = await find(property);
        if ("problem" in found) return found.problem!;
        accountId = found.account!.id;
      }
      let q = supabase.from("invoices").select("id, account_id, invoice_number, status, invoice_date, due_date, total_cents, service_category, kind, late_fee_for, account:billing_accounts(property:properties(name))").neq("status", "void");
      if (accountId) q = q.eq("account_id", accountId);
      if (dated_from && DATE.test(dated_from)) q = q.gte("invoice_date", dated_from);
      if (dated_to && DATE.test(dated_to)) q = q.lte("invoice_date", dated_to);
      const [inv, applied, credits] = await Promise.all([q, supabase.from("payment_applications").select("invoice_id, amount_cents"), supabase.from("credit_memos").select("invoice_id, amount_cents")]);
      if (inv.error) return `Could not load invoices: ${inv.error.message}`;
      const reduced = new Map<string, number>();
      for (const r of [...(applied.data ?? []), ...(credits.data ?? [])]) if (r.invoice_id) reduced.set(r.invoice_id, (reduced.get(r.invoice_id) ?? 0) + Number(r.amount_cents));
      type Row = { id: string; invoice_number: number | null; status: string; invoice_date: string; due_date: string; total_cents: number; service_category: string | null; late_fee_for: string | null; account: { property: { name: string } } };
      const rows = ((inv.data ?? []) as unknown as Row[]).map((r) => {
        const open = r.status === "draft" ? 0 : Math.max(0, Number(r.total_cents) - (reduced.get(r.id) ?? 0));
        return { ...r, open, overdue: open > 0 && r.due_date < today && r.status !== "approved" };
      }).filter((r) =>
        status === "all" ? true : status === "draft" ? r.status === "draft" : status === "ready_to_send" ? r.status === "approved" : status === "paid" ? r.status !== "draft" && r.open === 0 : status === "overdue" ? r.overdue : r.status !== "draft" && r.open > 0,
      ).sort((a, b) => a.invoice_date.localeCompare(b.invoice_date));
      const shown = rows.slice(-80);
      return json({
        as_of: today, count: rows.length, shown: shown.length,
        total_amount: formatCents(rows.reduce((s, r) => s + Number(r.total_cents), 0)), total_still_owed: formatCents(rows.reduce((s, r) => s + r.open, 0)),
        invoices: shown.map((r) => ({ number: r.invoice_number ?? "draft", property: r.account.property.name, service: r.late_fee_for ? "late fee" : r.service_category, dated: r.invoice_date, due: r.due_date, amount: formatCents(Number(r.total_cents)), still_owed: formatCents(r.open), status: r.status === "draft" ? "draft" : r.open === 0 ? "paid" : r.overdue ? "overdue" : r.status === "approved" ? "approved, not sent" : "sent, unpaid", page: `/invoices/${r.id}` })),
      });
    },
  });

  const listProducts = betaZodTool({
    name: "list_products",
    description: "The products and services that can go on an invoice, with their usual price. Call this before preparing a draft invoice, to use the exact product name.",
    inputSchema: z.object({}),
    run: async () => {
      const { data, error } = await supabase.from("service_items").select("name, category, default_rate_cents").eq("is_active", true).order("sort_order");
      if (error) return `Could not load products: ${error.message}`;
      return json((data ?? []).map((i) => ({ name: i.name, service: i.category, usual_price: i.default_rate_cents == null ? "none set" : formatCents(Number(i.default_rate_cents)) })));
    },
  });

  const draftInvoice = betaZodTool({
    name: "prepare_draft_invoice",
    description: "Prepares a one-off DRAFT invoice for a property. A draft has no number, is not on the books, and is not sent; a person must approve it in Review and then send it. Only call this when the person has asked for a draft and given the property, what was done, and how many. If a price was not given, use the product's usual price and say so. Never call it twice for the same request.",
    inputSchema: z.object({
      property: z.string().describe("The property name, or part of it"),
      invoice_date: z.string().describe("Invoice date, YYYY-MM-DD. Use today unless told otherwise."),
      memo: z.string().optional().describe("A short note printed on the invoice"),
      service_month: z.string().optional().describe("The month the work belongs to, as YYYY-MM-01, when it is not the month of the invoice date"),
      lines: z.array(z.object({
        product: z.string().describe("Exact product or service name from list_products, or a plain description if none fits"),
        description: z.string().optional().describe("What was done, if more detail than the product name is useful"),
        quantity: z.number().positive(),
        rate_dollars: z.number().optional().describe("Price for one, in dollars. Leave out to use the product's usual price."),
        service_date: z.string().optional().describe("The day the work was done, YYYY-MM-DD. Defaults to the invoice date."),
      })).min(1).max(20),
    }),
    run: async ({ property, invoice_date, memo, lines, service_month }) => {
      if (!DATE.test(invoice_date)) return "The invoice date must be YYYY-MM-DD.";
      const forMonth = service_month && DATE.test(service_month) ? monthStart(service_month) : monthStart(invoice_date);
      const found = await find(property);
      if ("problem" in found) return found.problem!;
      const a = found.account!;
      const { data: items, error: itemsError } = await supabase.from("service_items").select("id, name, category, default_rate_cents").eq("is_active", true);
      if (itemsError) return `Could not load products: ${itemsError.message}`;
      const built: Record<string, unknown>[] = [];
      let category = "";
      for (const l of lines) {
        const item = (items ?? []).find((i) => i.name.toLowerCase() === l.product.trim().toLowerCase());
        const rate = l.rate_dollars != null ? parseSignedDollarsToCents(l.rate_dollars.toFixed(2)) : item?.default_rate_cents != null ? Number(item.default_rate_cents) : null;
        if (rate === null) return `"${l.product}" has no usual price, so a price is needed. Ask for it.`;
        const amount = lineAmountCents(String(l.quantity), rate);
        if (amount === null) return `The quantity for "${l.product}" can have at most two decimals.`;
        const date = l.service_date && DATE.test(l.service_date) ? l.service_date : invoice_date;
        if (!category && item && isServiceCategory(item.category)) category = item.category;
        built.push({ line_type: amount < 0 ? "adjustment" : "per_event", description: l.description?.trim() || item?.name || l.product.trim(), quantity: String(l.quantity), unit_price_cents: rate, amount_cents: amount, service_item_id: item?.id ?? "", period_start: date, period_end: date });
      }
      const total = built.reduce((sum, l) => sum + (l.amount_cents as number), 0);
      if (total <= 0) return "The invoice total must be above zero.";
      const twin = await supabase.from("invoices").select("invoice_number").eq("account_id", a.id).eq("invoice_date", invoice_date).eq("service_month", forMonth).eq("total_cents", total).neq("status", "void").limit(1);
      if (twin.data?.[0]) return `Not created: ${twin.data[0].invoice_number ? `invoice ${twin.data[0].invoice_number}` : "a draft"} already exists for ${a.property.name} on ${invoice_date} for ${formatCents(total)}. That would be a duplicate.`;
      const netDays = a.contracts.find((c) => c.status !== "ended")?.net_days ?? 30;
      const { data, error } = await supabase.rpc("create_draft_invoice", {
        p: { account_id: a.id, service_month: forMonth, invoice_date, due_date: addDays(invoice_date, netDays), subtotal_cents: total, tax_cents: 0, total_cents: total, kind: "ad_hoc", service_category: category || "other", memo: memo?.trim() ?? "", lines: built },
      });
      if (error) return `The draft was not created: ${error.message}`;
      return json({ created: "draft", property: a.property.name, total: formatCents(total), dated: invoice_date, due: addDays(invoice_date, netDays), page: `/invoices/${data as string}`, next_step: "It is waiting in Invoices, Review. It is not approved, not on the books, and not sent." });
    },
  });

  const goingOut = betaZodTool({
    name: "whats_waiting",
    description: "What is waiting on a person right now: drafts to review, approved invoices not yet sent, properties with invoices more than five days overdue that have not had a notice, and whether QuickBooks and email are connected.",
    inputSchema: z.object({}),
    run: async () => {
      const [drafts, approved, qbo] = await Promise.all([
        supabase.from("invoices").select("id", { count: "exact", head: true }).eq("status", "draft"),
        supabase.from("invoices").select("id", { count: "exact", head: true }).eq("status", "approved"),
        supabase.from("qbo_connection").select("company_name, last_synced_at, last_sync_note").maybeSingle(),
      ]);
      return json({
        as_of: today, drafts_to_review: drafts.count ?? 0, approved_ready_to_send: approved.count ?? 0,
        quickbooks: qbo.data ? { connected_to: qbo.data.company_name, last_checked: qbo.data.last_synced_at, last_result: qbo.data.last_sync_note } : "not connected, so payments are not flowing in and every invoice shows as unpaid",
        email_sending: process.env.RESEND_API_KEY ? "connected" : "not connected",
        page: "/outbox",
      });
    },
  });

  const draftMonths = betaZodTool({
    name: "draft_monthly_invoices",
    description: "Drafts a property's regular monthly invoice (valet or trash room) for one or more service months, from the rate the app holds. Use it when asked to draft or back-bill specific months. Drafts only: nothing is approved or sent. A month the app normally bills is drafted the usual way and can never be made twice. A month from before the property started billing in this app may already have been invoiced in QuickBooks, so the tool first reports the amounts and any QuickBooks invoices on file and asks for confirmation; call it again with confirmed_not_already_billed true only after the person has said those months were not billed.",
    inputSchema: z.object({
      property: z.string().describe("The property name, or part of it"),
      months: z.array(z.string()).min(1).max(12).describe("Service months as YYYY-MM-01, for example ['2026-09-01', '2026-10-01']"),
      price: z.enum(["current", "as_scheduled"]).describe("current = today's rate for every month asked for; as_scheduled = the rate that applied in each month. Use 'current' when the person says current price."),
      confirmed_not_already_billed: z.boolean().describe("True only after the person has confirmed these months were not already invoiced in QuickBooks"),
    }),
    run: async ({ property, months, price, confirmed_not_already_billed }) => {
      const found = await find(property);
      if ("problem" in found) return found.problem!;
      const a = found.account!;
      const wanted = [...new Set(months.filter((m) => DATE.test(m)).map((m) => monthStart(m)))].sort();
      if (wanted.length === 0) return "Give the months as YYYY-MM-01.";
      const monthly = a.contracts.filter((c) => c.status !== "ended" && c.billing_model !== "per_event" && c.billing_model !== "as_needed");
      if (monthly.length === 0) return `${a.property.name} has no monthly service set up, only per-job work. Use prepare_draft_invoice for a one-off.`;

      const [existing, onFile] = await Promise.all([
        supabase.from("invoices").select("invoice_number, status, service_month, service_category, total_cents, kind").eq("account_id", a.id).in("service_month", wanted).eq("origin", "app").neq("status", "void"),
        supabase.from("invoices").select("invoice_number, invoice_date, total_cents").eq("account_id", a.id).eq("origin", "quickbooks_import").order("invoice_date"),
      ]);
      const results: Record<string, unknown>[] = [];
      const needConfirm: Record<string, unknown>[] = [];

      for (const m of wanted) {
        for (const c of monthly) {
          const service = c.service_category ?? "valet";
          const label = `${monthLabel(m)}, ${service}`;
          const already = (existing.data ?? []).find((i) => i.service_month === m && (i.service_category ?? "") === service && Number(i.total_cents) > 0);
          if (already) { results.push({ month: label, result: `left alone: ${already.invoice_number ? `invoice ${already.invoice_number}` : "a draft"} already exists for it here` }); continue; }

          // Today's rate applied to the whole month, or the rate that was in force that month.
          const today1 = monthStart(today);
          const phasesNow = billingPhases(c, today1).filter((p: Phase & { superseded_at?: string | null }) => !p.superseded_at && p.effective_start <= monthEnd(today1));
          const current = [...phasesNow].sort((x, y) => x.effective_start.localeCompare(y.effective_start)).at(-1);
          const lines = price === "current" && current
            ? recurringLines({ model: c.billing_model, phases: [{ ...current, effective_start: "1900-01-01" }], serviceMonth: m })
            : recurringLines({ model: c.billing_model, phases: billingPhases(c, m), serviceMonth: m, contractStart: c.start_date });
          const total = lines.reduce((sum, l) => sum + l.amount_cents, 0);
          if (lines.length === 0 || total <= 0) { results.push({ month: label, result: "nothing to bill: no rate applies to that month" }); continue; }

          const normal = c.status === "active" && mayInvoice(m, a.go_live_service_month) && price === "as_scheduled";
          if (normal) {
            const run = await generateDrafts(supabase, m, [a.id]);
            results.push({ month: label, result: run.created.length ? `drafted the usual way for ${formatCents(total)}` : `not drafted: ${run.skipped.map((x) => x.reason).join(" ") || "it was already there"}` });
            continue;
          }
          if (!confirmed_not_already_billed) { needConfirm.push({ month: label, would_bill: formatCents(total), lines: lines.map((l) => l.description) }); continue; }

          const twin = await supabase.from("invoices").select("invoice_number").eq("account_id", a.id).eq("invoice_date", today).eq("service_month", m).eq("total_cents", total).neq("status", "void").limit(1);
          if (twin.data?.[0]) { results.push({ month: label, result: "left alone: the same draft already exists" }); continue; }
          const netDays = c.net_days ?? 30;
          const { data, error } = await supabase.rpc("create_draft_invoice", {
            p: { account_id: a.id, service_month: m, invoice_date: today, due_date: addDays(today, netDays), subtotal_cents: total, tax_cents: 0, total_cents: total, kind: "ad_hoc", service_category: service, memo: `Service for ${monthLabel(m)}.`,
              lines: lines.map((l) => ({ ...l, description: `${l.description}, ${monthLabel(m)}`, quantity: String(l.quantity), contract_phase_id: "", billable_event_id: "", period_start: m, period_end: monthEnd(m) })) },
          });
          results.push(error ? { month: label, result: `not drafted: ${error.message}` } : { month: label, result: `draft created for ${formatCents(total)}`, page: `/invoices/${data as string}` });
        }
      }
      if (needConfirm.length) {
        return json({
          property: a.property.name, nothing_drafted_yet_for: needConfirm, already_handled: results,
          why: `These months are from before ${a.property.name} started billing in this app${a.go_live_service_month ? ` (its first month here is ${monthLabel(a.go_live_service_month)})` : ""}, or its billing is switched off, or today's price was asked for. They may already have been invoiced in QuickBooks.`,
          quickbooks_invoices_on_file_for_this_property: (onFile.data ?? []).map((i) => ({ number: i.invoice_number, dated: i.invoice_date, amount: formatCents(Number(i.total_cents)) })),
          ask_the_person: "Show the amounts and any QuickBooks invoices above, and ask them to confirm these months were not already billed. Only then call again with confirmed_not_already_billed true.",
        });
      }
      return json({ property: a.property.name, results, next_step: "Drafts wait in Invoices, Review. Nothing is approved, on the books, or sent." });
    },
  });

  return [listAccounts, getAccount, findInvoices, listProducts, draftInvoice, draftMonths, goingOut];
}
