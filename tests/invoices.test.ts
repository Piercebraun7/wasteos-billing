import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { as, createDatabase, type Identity } from "./db";

const admin: Identity = {
  role: "authenticated",
  claims: { sub: "00000000-0000-0000-0000-0000000000a1", app_metadata: { role: "billing_admin" }, user_metadata: { full_name: "Test Admin" } },
};
const stranger: Identity = { role: "authenticated", claims: { sub: "00000000-0000-0000-0000-00000000000c" } };

let db: PGlite;
let account: string;

const draft = (month: string, total = 300000) =>
  JSON.stringify({
    account_id: account, service_month: month, invoice_date: "2026-11-30", due_date: "2026-12-30",
    subtotal_cents: total, tax_cents: 0, total_cents: total,
    lines: [{ line_type: "valet", description: "Valet service, 240 units at $12.50", quantity: 240, unit_price_cents: 1250, amount_cents: total }],
  });
const one = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0];
const balance = async () => Number((await one<{ b: number }>("select balance_cents as b from public.account_overview where account_id = $1", [account])).b);

beforeAll(async () => {
  db = await createDatabase();
  await as(db, admin, async () => {
    account = (await one<{ id: string }>("select public.create_billing_account($1) as id", [
      JSON.stringify({ customer_name: "Client", property: { name: "Property" }, contract: { billing_model: "per_unit_valet" } }),
    ])).id;
  }, { commit: true });
}, 60_000);

describe("cutover guard", () => {
  it("refuses to draft before a go-live month is set", async () => {
    await expect(as(db, admin, () => db.query("select public.create_draft_invoice($1)", [draft("2026-11-01")]))).rejects.toThrow(/no go-live service month/);
  });
  it("refuses any month before go-live, and allows go-live onward", async () => {
    await as(db, admin, () => db.query("update public.billing_accounts set go_live_service_month = '2026-11-01' where id = $1", [account]), { commit: true });
    await expect(as(db, admin, () => db.query("select public.create_draft_invoice($1)", [draft("2026-10-01")]))).rejects.toThrow(/goes live with November 2026/);
    await as(db, admin, async () => {
      const id = (await one<{ id: string }>("select public.create_draft_invoice($1) as id", [draft("2026-11-01")])).id;
      expect(id).toBeTruthy();
    });
  });
  it("allows only one live invoice per account per month", async () => {
    await expect(
      as(db, admin, async () => {
        await db.query("select public.create_draft_invoice($1)", [draft("2026-11-01")]);
        await db.query("select public.create_draft_invoice($1)", [draft("2026-11-01")]);
      }),
    ).rejects.toThrow(/duplicate key/);
  });
});

describe("approval", () => {
  it("needs a starting invoice number", async () => {
    await expect(
      as(db, admin, async () => {
        const id = (await one<{ id: string }>("select public.create_draft_invoice($1) as id", [draft("2026-11-01")])).id;
        await db.query("select public.approve_invoice($1)", [id]);
      }),
    ).rejects.toThrow(/next invoice number/);
  });

  it("assigns sequential numbers, posts to the ledger, and the balance is the ledger sum", async () => {
    await as(db, admin, async () => {
      await db.query("update public.app_settings set next_invoice_number = 1219");
      expect(await balance()).toBe(0);
      const a = (await one<{ id: string }>("select public.create_draft_invoice($1) as id", [draft("2026-11-01", 300000)])).id;
      const b = (await one<{ id: string }>("select public.create_draft_invoice($1) as id", [draft("2026-12-01", 150000)])).id;
      expect(await balance()).toBe(0); // drafts never touch the balance
      expect(Number((await one<{ n: number }>("select public.approve_invoice($1) as n", [a])).n)).toBe(1219);
      expect(Number((await one<{ n: number }>("select public.approve_invoice($1) as n", [b])).n)).toBe(1220);
      expect(await balance()).toBe(450000);
      const entry = await one<{ entry_type: string; amount_cents: number; entry_date: string; description: string }>(
        "select entry_type, amount_cents, entry_date::text, description from public.ledger_entries where source_id = $1", [a]);
      expect(entry).toMatchObject({ entry_type: "invoice", entry_date: "2026-11-30", description: "Invoice 1219" });
      expect(Number(entry.amount_cents)).toBe(300000);
      const inv = await one<{ status: string; approved_by: string }>("select status, approved_by from public.invoices where id = $1", [a]);
      expect(inv).toMatchObject({ status: "approved", approved_by: "00000000-0000-0000-0000-0000000000a1" });
    });
  });

  it("skips a number that already exists, so numbers never collide", async () => {
    await as(db, admin, async () => {
      await db.query("update public.app_settings set next_invoice_number = 5");
      const a = (await one<{ id: string }>("select public.create_draft_invoice($1) as id", [draft("2026-11-01")])).id;
      await db.query("select public.approve_invoice($1)", [a]);
      await db.query("update public.app_settings set next_invoice_number = 5");
      const b = (await one<{ id: string }>("select public.create_draft_invoice($1) as id", [draft("2026-12-01")])).id;
      expect(Number((await one<{ n: number }>("select public.approve_invoice($1) as n", [b])).n)).toBe(6);
    });
  });

  it("cannot approve twice, and a non-admin cannot approve at all", async () => {
    await expect(
      as(db, admin, async () => {
        await db.query("update public.app_settings set next_invoice_number = 1");
        const a = (await one<{ id: string }>("select public.create_draft_invoice($1) as id", [draft("2026-11-01")])).id;
        await db.query("select public.approve_invoice($1)", [a]);
        await db.query("select public.approve_invoice($1)", [a]);
      }),
    ).rejects.toThrow(/Only a draft can be approved/);
    await expect(as(db, stranger, () => db.query("select public.approve_invoice(gen_random_uuid())"))).rejects.toThrow(/Only a billing admin/);
  });
});

describe("a posted invoice is never edited", () => {
  const approved = async () => {
    await db.query("update public.app_settings set next_invoice_number = 100");
    const id = (await one<{ id: string }>("select public.create_draft_invoice($1) as id", [draft("2026-11-01")])).id;
    await db.query("select public.approve_invoice($1)", [id]);
    return id;
  };
  it.each([
    ["change the total", "update public.invoices set total_cents = 1, subtotal_cents = 1 where id = $1"],
    ["change the due date", "update public.invoices set due_date = '2027-01-30' where id = $1"],
    ["change the number", "update public.invoices set invoice_number = 9 where id = $1"],
    ["go back to draft", "update public.invoices set status = 'draft' where id = $1"],
    ["delete it", "delete from public.invoices where id = $1"],
    ["change a line", "update public.invoice_lines set amount_cents = 1 where invoice_id = $1"],
    ["delete a line", "delete from public.invoice_lines where invoice_id = $1"],
    ["add a line", "insert into public.invoice_lines (invoice_id, line_type, description, amount_cents) values ($1, 'adjustment', 'x', 1)"],
    ["reject it", "select public.reject_draft($1)"],
    ["recalculate it", "select public.recalculate_draft($1)"],
  ])("cannot %s", async (_name, sql) => {
    await expect(as(db, admin, async () => db.query(sql, [await approved()]))).rejects.toThrow(/posted|Only a draft|cannot go back/);
  });

  it("can still be marked sent", async () => {
    await as(db, admin, async () => {
      const res = await db.query("update public.invoices set status = 'sent', sent_at = now() where id = $1", [await approved()]);
      expect(res.affectedRows).toBe(1);
    });
  });
});

describe("drafts", () => {
  it("can be edited and recalculated, then rejected without using a number", async () => {
    await as(db, admin, async () => {
      await db.query("update public.app_settings set next_invoice_number = 500");
      const id = (await one<{ id: string }>("select public.create_draft_invoice($1) as id", [draft("2026-11-01")])).id;
      await db.query("update public.invoice_lines set amount_cents = 250000 where invoice_id = $1", [id]);
      await db.query("select public.recalculate_draft($1)", [id]);
      expect(Number((await one<{ t: number }>("select total_cents as t from public.invoices where id = $1", [id])).t)).toBe(250000);
      await db.query("select public.reject_draft($1)", [id]);
      expect((await db.query("select 1 from public.invoices where id = $1", [id])).rows).toHaveLength(0);
      expect(Number((await one<{ n: number }>("select next_invoice_number as n from public.app_settings")).n)).toBe(500);
    });
  });

  it("has the confirmed 3% monthly late fee template", async () => {
    const t = await one<{ percent_bps: number; frequency: string; recurrence_interval_days: number; compounding: boolean; grace_days: number; confirmed: boolean }>(
      "select percent_bps, frequency, recurrence_interval_days, compounding, grace_days, confirmed_at is not null as confirmed from public.late_fee_templates where name = '3% monthly'");
    expect(t).toEqual({ percent_bps: 300, frequency: "recurring", recurrence_interval_days: 30, compounding: true, grace_days: 0, confirmed: true });
  });
});

describe("replacing a schedule", () => {
  const contractId = async () => (await one<{ id: string }>("select id from public.contracts where account_id = $1", [account])).id;
  const phases = JSON.stringify([
    { label: "Free months", effective_start: "2026-11-01", billable_units: 240, rate_per_unit_cents: 0 },
    { label: "Full rate", effective_start: "2027-02-01", billable_units: 240, rate_per_unit_cents: 1250 },
  ]);

  it("swaps every phase in one step", async () => {
    await as(db, admin, async () => {
      const id = await contractId();
      await db.query("insert into public.contract_phases (contract_id, label, effective_start, flat_amount_cents) values ($1, 'Old', '2026-01-01', 100)", [id]);
      const n = (await one<{ n: number }>("select public.replace_contract_phases($1, $2) as n", [id, phases])).n;
      expect(n).toBe(2);
      const rows = (await db.query<{ label: string }>("select label from public.contract_phases where contract_id = $1 order by effective_start", [id])).rows;
      expect(rows.map((r) => r.label)).toEqual(["Free months", "Full rate"]);
    });
  });

  it("refuses when a phase has been invoiced, and changes nothing", async () => {
    await expect(
      as(db, admin, async () => {
        const id = await contractId();
        const phase = (await one<{ id: string }>("insert into public.contract_phases (contract_id, label, effective_start, flat_amount_cents) values ($1, 'Billed', '2026-01-01', 100) returning id", [id])).id;
        const inv = (await one<{ id: string }>("select public.create_draft_invoice($1) as id", [draft("2026-11-01")])).id;
        await db.query("update public.invoice_lines set contract_phase_id = $1 where invoice_id = $2", [phase, inv]);
        await db.query("select public.replace_contract_phases($1, $2)", [id, phases]);
      }),
    ).rejects.toThrow(/has been invoiced/);
  });

  it("is refused for anyone who is not a billing admin", async () => {
    await expect(as(db, stranger, () => db.query("select public.replace_contract_phases(gen_random_uuid(), $1)", [phases]))).rejects.toThrow(/Only a billing admin/);
  });
});

describe("services and ad hoc invoices", () => {
  const body = (extra: Record<string, unknown>) => JSON.stringify({ ...JSON.parse(draft("2026-11-01")), ...extra });

  it("allows one scheduled invoice per service per month, and no more", async () => {
    await as(db, admin, async () => {
      await db.query("select public.create_draft_invoice($1)", [body({ service_category: "valet" })]);
      await db.query("select public.create_draft_invoice($1)", [body({ service_category: "bulk" })]);
    });
    await expect(
      as(db, admin, async () => {
        await db.query("select public.create_draft_invoice($1)", [body({ service_category: "bulk" })]);
        await db.query("select public.create_draft_invoice($1)", [body({ service_category: "bulk" })]);
      }),
    ).rejects.toThrow(/duplicate key/);
  });

  it("allows any number of ad hoc invoices, even before go-live, with a memo and a catalog item", async () => {
    await as(db, admin, async () => {
      const item = (await one<{ id: string }>("select id from public.service_items where name = 'Scheduled Bulk Waste Service'")).id;
      const lines = [{ line_type: "per_event", description: "Scheduled Bulk Waste Service", quantity: 1.5, unit_price_cents: 35000, amount_cents: 52500, service_item_id: item }];
      for (let i = 0; i < 3; i++) {
        await db.query("select public.create_draft_invoice($1)", [
          JSON.stringify({ account_id: account, service_month: "2026-09-01", invoice_date: "2026-09-10", due_date: "2026-10-10", subtotal_cents: 52500, tax_cents: 0, total_cents: 52500, kind: "ad_hoc", service_category: "bulk", memo: "Move-out cleanup", lines }),
        ]);
      }
      const rows = (await db.query<{ kind: string; memo: string; item: string }>(
        "select i.kind, i.memo, l.service_item_id as item from public.invoices i join public.invoice_lines l on l.invoice_id = i.id where i.kind = 'ad_hoc'")).rows;
      expect(rows).toHaveLength(3);
      expect(rows[0]).toMatchObject({ kind: "ad_hoc", memo: "Move-out cleanup", item });
    });
  });

  it("starts with the products and services carried over from QuickBooks", async () => {
    const rows = (await db.query<{ name: string; category: string; r: number | null }>("select name, category, default_rate_cents as r from public.service_items order by sort_order")).rows;
    expect(rows).toHaveLength(11);
    expect(rows.find((r) => r.name === "Scheduled Bulk Waste Service")).toMatchObject({ category: "bulk" });
    expect(Number(rows.find((r) => r.name === "Resident Satisfaction Discount")!.r)).toBe(-2500);
  });

  it("gives every contract a service", async () => {
    const c = await one<{ service_category: string }>("select service_category from public.contracts where account_id = $1", [account]);
    expect(c.service_category).toBe("valet");
  });
});

describe("removing a property", () => {
  const make = async (name: string) =>
    (await one<{ id: string }>("select public.create_billing_account($1) as id", [
      JSON.stringify({ customer_name: "Solo Client " + name, property: { name }, contacts: [{ name: "AP", email: "ap@example.com" }], contract: { billing_model: "per_unit_valet" },
        phases: [{ label: "Full rate", effective_start: "2026-01-01", billable_units: "10", rate_per_unit_cents: "1250" }] }),
    ])).id;
  const count = async (sql: string, id: string) => Number((await one<{ n: number }>(sql, [id])).n);

  it("deletes a property that was never invoiced, with its drafts, schedule, contacts, and now-empty client", async () => {
    await as(db, admin, async () => {
      const id = await make("Never Billed");
      await db.query("update public.billing_accounts set go_live_service_month = '2026-11-01' where id = $1", [id]);
      await db.query("select public.create_draft_invoice($1)", [JSON.stringify({ ...JSON.parse(draft("2026-11-01")), account_id: id })]);
      const result = (await one<{ r: string }>("select public.delete_billing_account($1) as r", [id])).r;
      expect(result).toBe("deleted");
      expect(await count("select count(*) n from public.billing_accounts where id = $1", id)).toBe(0);
      expect(await count("select count(*) n from public.invoices where account_id = $1", id)).toBe(0);
      expect(await count("select count(*) n from public.billing_contacts where account_id = $1", id)).toBe(0);
      expect(Number((await one<{ n: number }>("select count(*) n from public.properties where name = 'Never Billed'")).n)).toBe(0);
      expect(Number((await one<{ n: number }>("select count(*) n from public.customers where name = 'Solo Client Never Billed'")).n)).toBe(0);
    });
  });

  it("archives a property that has been invoiced, keeping its invoice and balance", async () => {
    await as(db, admin, async () => {
      const id = await make("Billed Once");
      await db.query("update public.billing_accounts set go_live_service_month = '2026-11-01' where id = $1", [id]);
      await db.query("update public.app_settings set next_invoice_number = 9000");
      const inv = (await one<{ id: string }>("select public.create_draft_invoice($1) as id", [JSON.stringify({ ...JSON.parse(draft("2026-11-01")), account_id: id })])).id;
      await db.query("select public.approve_invoice($1)", [inv]);
      const result = (await one<{ r: string }>("select public.delete_billing_account($1) as r", [id])).r;
      expect(result).toBe("archived");
      expect((await one<{ status: string }>("select status from public.billing_accounts where id = $1", [id])).status).toBe("inactive");
      expect(await count("select count(*) n from public.invoices where account_id = $1", id)).toBe(1);
      expect(await count("select count(*) n from public.ledger_entries where account_id = $1", id)).toBe(1);
      expect(await count("select count(*) n from public.contracts where account_id = $1 and status = 'ended'", id)).toBe(1);
    });
  });

  it("is refused for anyone who is not a billing admin", async () => {
    await expect(as(db, stranger, () => db.query("select public.delete_billing_account(gen_random_uuid())"))).rejects.toThrow(/Only a billing admin/);
  });

  it("contacts default to the To line and can be set to CC", async () => {
    await as(db, admin, async () => {
      const id = await make("Contact Kinds");
      await db.query("insert into public.billing_contacts (account_id, name, email, delivery) values ($1, 'Regional', 'r@example.com', 'cc')", [id]);
      const rows = (await db.query<{ delivery: string }>("select delivery from public.billing_contacts where account_id = $1 order by delivery", [id])).rows;
      expect(rows.map((r) => r.delivery)).toEqual(["cc", "to"]);
    });
  });
});

describe("recurring invoices", () => {
  const template = async () =>
    (await one<{ id: string }>(
      "insert into public.recurring_invoices (account_id, name, day_of_month, start_month, lines) values ($1, 'Monthly bulk', 10, '2026-11-01', $2) returning id",
      [account, JSON.stringify([{ description: "Scheduled Bulk Waste Service", quantity: "1", unit_price_cents: 35000 }])],
    )).id;
  const fromTemplate = (id: string, month: string) =>
    JSON.stringify({ ...JSON.parse(draft(month)), kind: "ad_hoc", service_category: "bulk", recurring_invoice_id: id, invoice_date: month.slice(0, 8) + "10" });

  it("produces one invoice per month and no more", async () => {
    await as(db, admin, async () => {
      const id = await template();
      await db.query("select public.create_draft_invoice($1)", [fromTemplate(id, "2026-11-01")]);
      await db.query("select public.create_draft_invoice($1)", [fromTemplate(id, "2026-12-01")]);
      const n = Number((await one<{ n: number }>("select count(*) n from public.invoices where recurring_invoice_id = $1", [id])).n);
      expect(n).toBe(2);
    });
    await expect(
      as(db, admin, async () => {
        const id = await template();
        await db.query("select public.create_draft_invoice($1)", [fromTemplate(id, "2026-11-01")]);
        await db.query("select public.create_draft_invoice($1)", [fromTemplate(id, "2026-11-01")]);
      }),
    ).rejects.toThrow(/duplicate key/);
  });

  it("only allows a day from 1 to 28, so every month has that day", async () => {
    await expect(
      as(db, admin, () => db.query("insert into public.recurring_invoices (account_id, name, day_of_month, start_month, lines) values ($1, 'x', 31, '2026-11-01', '[{}]')", [account])),
    ).rejects.toThrow(/check constraint/);
  });

  it("is removed with a property that was never invoiced", async () => {
    await as(db, admin, async () => {
      const acct = (await one<{ id: string }>("select public.create_billing_account($1) as id", [JSON.stringify({ customer_name: "Tmp", property: { name: "Tmp Recurring" }, contract: { billing_model: "per_event" } })])).id;
      await db.query("insert into public.recurring_invoices (account_id, name, day_of_month, start_month, lines) values ($1, 'x', 5, '2026-11-01', '[{}]')", [acct]);
      expect((await one<{ r: string }>("select public.delete_billing_account($1) as r", [acct])).r).toBe("deleted");
      expect(Number((await one<{ n: number }>("select count(*) n from public.recurring_invoices where account_id = $1", [acct])).n)).toBe(0);
    });
  });
});
