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
    expect(t).toEqual({ percent_bps: 300, frequency: "recurring", recurrence_interval_days: 30, compounding: false, grace_days: 0, confirmed: true });
  });
});
