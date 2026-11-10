import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { as, count, createDatabase, type Identity } from "./db";

const ADMIN_ID = "00000000-0000-0000-0000-0000000000a1";
const USER_A = "00000000-0000-0000-0000-00000000000a";
const USER_B = "00000000-0000-0000-0000-00000000000b";
const STRANGER = "00000000-0000-0000-0000-00000000000c";

const admin: Identity = {
  role: "authenticated",
  claims: {
    sub: ADMIN_ID,
    email: "admin@example.com",
    app_metadata: { role: "billing_admin" },
    user_metadata: { full_name: "Test Admin" },
  },
};
const contactA: Identity = { role: "authenticated", claims: { sub: USER_A, email: "a@example.com" } };
const contactB: Identity = { role: "authenticated", claims: { sub: USER_B, email: "b@example.com" } };
// Signed in, but neither an admin nor linked to any customer.
const stranger: Identity = { role: "authenticated", claims: { sub: STRANGER, email: "c@example.com" } };
// Tries to grant themselves admin through the field users can edit.
const pretender: Identity = {
  role: "authenticated",
  claims: { sub: STRANGER, user_metadata: { role: "billing_admin" } },
};
const anon: Identity = { role: "anon" };

const ALL_TABLES = [
  "customers", "owner_entities", "properties", "billing_accounts", "customer_users",
  "billing_contacts", "account_send_defaults", "late_fee_templates", "contracts",
  "contract_phases", "contract_event_rates", "invoices", "billable_events", "invoice_lines",
  "payments", "payment_applications", "credit_memos", "adjustments", "disputes",
  "ledger_entries", "rebate_accruals", "email_sends", "qbo_sync_log",
  "source_discrepancies", "app_settings", "audit_log",
];
// What a customer contact may read (their own rows only).
const CUSTOMER_TABLES = [
  "customers", "properties", "billing_accounts", "customer_users", "invoices", "invoice_lines",
  "payments", "payment_applications", "credit_memos", "adjustments", "disputes", "ledger_entries",
];
const ADMIN_ONLY_TABLES = ALL_TABLES.filter((t) => !CUSTOMER_TABLES.includes(t));

let db: PGlite;
// Rows seeded per customer, keyed "A" and "B".
const ids: Record<string, Record<string, string>> = { A: {}, B: {} };

async function seedCustomer(key: "A" | "B", userId: string) {
  const one = async (sql: string, params: unknown[] = []) =>
    (await db.query<{ id: string }>(sql, params)).rows[0].id;
  const r = ids[key];
  r.account = await one("select public.create_billing_account($1) as id", [
    JSON.stringify({
      customer_name: `Customer ${key}`,
      owner_legal_name: `Owner ${key} LLC`,
      property: { name: `Property ${key}`, unit_count: "240", city: "Phoenix" },
      contacts: [{ name: `AP ${key}`, email: `ap-${key}@example.com`, role: "Accounts payable" }],
      contract: { billing_model: "per_unit_valet", start_date: "2026-01-01" },
      phases: [{ label: "Full rate", effective_start: "2026-01-01", billable_units: "240", rate_per_unit_cents: "1250" }],
    }),
  ]);
  r.customer = await one("select customer_id as id from public.billing_accounts where id = $1", [r.account]);
  r.property = await one("select property_id as id from public.billing_accounts where id = $1", [r.account]);
  r.phase = await one(
    "select ph.id from public.contract_phases ph join public.contracts c on c.id = ph.contract_id where c.account_id = $1",
    [r.account],
  );
  await db.query("insert into public.customer_users (user_id, customer_id) values ($1, $2)", [userId, r.customer]);
  await db.query("update public.billing_accounts set go_live_service_month = '2026-09-01' where id = $1", [r.account]);
  r.sent = await one(
    `insert into public.invoices (account_id, invoice_number, service_month, invoice_date, due_date, status, subtotal_cents, total_cents)
     values ($1, $2, '2026-09-01', '2026-09-30', '2026-10-30', 'draft', 300000, 300000) returning id`,
    [r.account, key === "A" ? 1001 : 1002],
  );
  r.draft = await one(
    `insert into public.invoices (account_id, service_month, invoice_date, due_date, status, subtotal_cents, total_cents)
     values ($1, '2026-10-01', '2026-10-31', '2026-11-30', 'draft', 300000, 300000) returning id`,
    [r.account],
  );
  for (const inv of [r.sent, r.draft]) {
    await db.query(
      `insert into public.invoice_lines (invoice_id, line_type, description, quantity, unit_price_cents, amount_cents, contract_phase_id)
       values ($1, 'valet', 'Valet service, 240 units at $12.50', 240, 1250, 300000, $2)`,
      [inv, r.phase],
    );
  }
  await db.query("update public.invoices set status = 'sent' where id = $1", [r.sent]);
  r.payment = await one(
    `insert into public.payments (customer_id, method, amount_cents, received_date, check_number)
     values ($1, 'check', 100000, '2026-10-15', '5501') returning id`,
    [r.customer],
  );
  await db.query(
    "insert into public.payment_applications (payment_id, invoice_id, account_id, amount_cents) values ($1, $2, $3, 100000)",
    [r.payment, r.sent, r.account],
  );
  r.credit = await one(
    "insert into public.credit_memos (account_id, invoice_id, amount_cents, reason, memo_date) values ($1, $2, 5000, 'Missed pickup', '2026-10-20') returning id",
    [r.account, r.sent],
  );
  await db.query(
    "insert into public.adjustments (account_id, amount_cents, reason, adjustment_date) values ($1, -100, 'Rounding', '2026-10-21')",
    [r.account],
  );
  await db.query(
    "insert into public.disputes (invoice_id, account_id, disputed_amount_cents, reason, opened_date) values ($1, $2, 20000, 'Unit count', '2026-10-22')",
    [r.sent, r.account],
  );
  await db.query(
    `insert into public.ledger_entries (account_id, entry_date, entry_type, amount_cents, source_table, source_id) values
       ($1, '2026-09-30', 'invoice', 300000, 'invoices', $2),
       ($1, '2026-10-15', 'payment', -100000, 'payments', $3),
       ($1, '2026-10-20', 'credit', -5000, 'credit_memos', $4)`,
    [r.account, r.sent, r.payment, r.credit],
  );
  // Admin-only extras, so "sees zero rows" is a real test and not an empty table.
  await db.query("insert into public.account_send_defaults (account_id, recipient_emails) values ($1, $2)", [r.account, [`ap-${key}@example.com`]]);
  await db.query("insert into public.billable_events (account_id, event_date, event_type) values ($1, '2026-10-05', 'bulk_pickup')", [r.account]);
  await db.query("insert into public.rebate_accruals (property_id, account_id, service_month, contractual_revenue_cents, rebate_bps, accrued_cents) values ($1, $2, '2026-09-01', 300000, 300, 9000)", [r.property, r.account]);
  await db.query("insert into public.email_sends (account_id, invoice_id, kind, recipients) values ($1, $2, 'invoice', $3)", [r.account, r.sent, [`ap-${key}@example.com`]]);
  await db.query("insert into public.qbo_sync_log (record_table, record_id, direction, status) values ('invoices', $1, 'push', 'ok')", [r.sent]);
  await db.query("insert into public.source_discrepancies (property_id, field, notion_value, spreadsheet_value) values ($1, 'rate', '12.50', '13.00')", [r.property]);
  const contract = await one("select id from public.contracts where account_id = $1", [r.account]);
  await db.query("insert into public.contract_event_rates (contract_id, event_type, rate_cents) values ($1, 'bulk_pickup', 7500)", [contract]);
}

beforeAll(async () => {
  db = await createDatabase();
  // Seed as the admin so the seed itself exercises the admin's write access.
  await as(db, admin, async () => {
    await db.query("delete from public.late_fee_templates"); await db.query("insert into public.late_fee_templates (name, percent_bps, grace_days) values ('Unconfirmed 1.5%', 150, 5)");
    await seedCustomer("A", USER_A);
    await seedCustomer("B", USER_B);
  }, { commit: true });
}, 60_000);

describe("every table is protected", () => {
  it("has Row Level Security switched on for every table", async () => {
    const res = await db.query<{ tablename: string; rowsecurity: boolean }>(
      "select tablename, rowsecurity from pg_tables where schemaname = 'public'",
    );
    expect(res.rows.map((r) => r.tablename).sort()).toEqual([...ALL_TABLES].sort());
    expect(res.rows.filter((r) => !r.rowsecurity)).toEqual([]);
  });
});

describe("signed-out visitor", () => {
  it.each([...ALL_TABLES, "account_overview"])("cannot read %s at all", async (table) => {
    await expect(as(db, anon, () => count(db, table))).rejects.toThrow(/permission denied/);
  });

  it("cannot call the New Account function", async () => {
    await expect(
      as(db, anon, () => db.query("select public.create_billing_account('{}'::jsonb)")),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("signed in, but not an admin and not linked to a customer", () => {
  it.each([...ALL_TABLES, "account_overview"])("sees zero rows in %s", async (table) => {
    expect(await as(db, stranger, () => count(db, table))).toBe(0);
  });

  it("cannot become an admin by editing their own profile fields", async () => {
    for (const table of ALL_TABLES) {
      expect(await as(db, pretender, () => count(db, table))).toBe(0);
    }
  });

  it("cannot insert anything", async () => {
    await expect(
      as(db, stranger, () => db.query("insert into public.customers (name) values ('Sneaky')")),
    ).rejects.toThrow(/row-level security/);
  });
});

describe("billing admin", () => {
  it("sees every row", async () => {
    await as(db, admin, async () => {
      for (const table of ALL_TABLES) {
        expect(await count(db, table), table).toBeGreaterThan(0);
      }
      expect(await count(db, "customers")).toBe(2);
      expect(await count(db, "invoices")).toBe(4);
      expect(await count(db, "account_overview")).toBe(2);
    });
  });

  it("can edit an account", async () => {
    await as(db, admin, async () => {
      await db.query("update public.properties set unit_count = 250 where id = $1", [ids.A.property]);
      const res = await db.query<{ unit_count: number }>("select unit_count from public.properties where id = $1", [ids.A.property]);
      expect(res.rows[0].unit_count).toBe(250);
    });
  });

  it("sees the balance as the sum of ledger entries", async () => {
    const res = await as(db, admin, () =>
      db.query<{ balance_cents: number }>("select balance_cents from public.account_overview where account_id = $1", [ids.A.account]),
    );
    expect(Number(res.rows[0].balance_cents)).toBe(300000 - 100000 - 5000);
  });
});

describe("customer contact for customer A", () => {
  it.each(ADMIN_ONLY_TABLES)("sees zero rows in admin-only table %s", async (table) => {
    expect(await as(db, contactA, () => count(db, table))).toBe(0);
  });

  it("sees exactly their own rows, and none of customer B's", async () => {
    await as(db, contactA, async () => {
      const expected: Record<string, number> = {
        customers: 1, properties: 1, billing_accounts: 1, customer_users: 1,
        invoices: 1, // the sent one; never the draft
        invoice_lines: 1, payments: 1, payment_applications: 1, credit_memos: 1,
        adjustments: 1, disputes: 1, ledger_entries: 3, account_overview: 1,
      };
      for (const [table, n] of Object.entries(expected)) {
        expect(await count(db, table), table).toBe(n);
      }
      const leak = async (sql: string, id: string) =>
        (await db.query(sql, [id])).rows.length;
      expect(await leak("select 1 from public.customers where id = $1", ids.B.customer)).toBe(0);
      expect(await leak("select 1 from public.properties where id = $1", ids.B.property)).toBe(0);
      expect(await leak("select 1 from public.billing_accounts where id = $1", ids.B.account)).toBe(0);
      expect(await leak("select 1 from public.invoices where account_id = $1", ids.B.account)).toBe(0);
      expect(await leak("select 1 from public.invoice_lines where invoice_id = $1", ids.B.sent)).toBe(0);
      expect(await leak("select 1 from public.payments where customer_id = $1", ids.B.customer)).toBe(0);
      expect(await leak("select 1 from public.ledger_entries where account_id = $1", ids.B.account)).toBe(0);
      expect(await leak("select 1 from public.account_overview where account_id = $1", ids.B.account)).toBe(0);
    });
  });

  it("cannot see their own draft invoice or its lines", async () => {
    await as(db, contactA, async () => {
      expect((await db.query("select 1 from public.invoices where id = $1", [ids.A.draft])).rows.length).toBe(0);
      expect((await db.query("select 1 from public.invoice_lines where invoice_id = $1", [ids.A.draft])).rows.length).toBe(0);
    });
  });

  it("is read-only: cannot insert, change, or remove", async () => {
    await expect(
      as(db, contactA, () => db.query("insert into public.billing_contacts (account_id, name, email) values ($1, 'X', 'x@example.com')", [ids.A.account])),
    ).rejects.toThrow(/row-level security/);
    await expect(
      as(db, contactA, () => db.query("insert into public.customer_users (user_id, customer_id) values ($1, $2)", [USER_A, ids.B.customer])),
    ).rejects.toThrow(/row-level security/);
    await as(db, contactA, async () => {
      const upd = await db.query("update public.invoices set status = 'paid' where id = $1", [ids.A.sent]);
      expect(upd.affectedRows).toBe(0);
      const del = await db.query("delete from public.customers where id = $1", [ids.A.customer]);
      expect(del.affectedRows).toBe(0);
    });
    await expect(
      as(db, contactA, () => db.query("select public.create_billing_account($1)", [JSON.stringify({ customer_name: "X", property: { name: "X" }, contract: { billing_model: "flat_monthly" } })])),
    ).rejects.toThrow(/Only a billing admin/);
  });

  it("customer B's contact sees B and not A", async () => {
    await as(db, contactB, async () => {
      expect(await count(db, "customers")).toBe(1);
      expect((await db.query("select 1 from public.customers where id = $1", [ids.B.customer])).rows.length).toBe(1);
      expect((await db.query("select 1 from public.invoices where account_id = $1", [ids.A.account])).rows.length).toBe(0);
    });
  });
});

describe("append-only ledger and audit log", () => {
  it.each(["ledger_entries", "audit_log"])("%s rejects updates and deletes from an admin", async (table) => {
    await expect(as(db, admin, () => db.query(`update public.${table} set created_at = now()`))).rejects.toThrow(/permission denied|append-only/);
    await expect(as(db, admin, () => db.query(`delete from public.${table}`))).rejects.toThrow(/permission denied|append-only/);
  });

  it.each(["ledger_entries", "audit_log"])("%s rejects updates, deletes, and truncate even from the database owner", async (table) => {
    await expect(db.query(`update public.${table} set created_at = now()`)).rejects.toThrow(/append-only/);
    await expect(db.query(`delete from public.${table}`)).rejects.toThrow(/append-only/);
    await expect(db.query(`truncate public.${table}`)).rejects.toThrow(/append-only/);
  });
});

describe("audit log", () => {
  it("records who changed what, with before and after values", async () => {
    await as(db, admin, async () => {
      await db.query("update public.properties set unit_count = 260 where id = $1", [ids.A.property]);
      const res = await db.query<{ actor_name: string; actor_id: string; before: { unit_count: number }; after: { unit_count: number } }>(
        "select actor_name, actor_id, before, after from public.audit_log where table_name = 'properties' and record_id = $1 and action = 'update'",
        [ids.A.property],
      );
      expect(res.rows).toHaveLength(1);
      expect(res.rows[0].actor_name).toBe("Test Admin");
      expect(res.rows[0].actor_id).toBe(ADMIN_ID);
      expect(res.rows[0].before.unit_count).toBe(240);
      expect(res.rows[0].after.unit_count).toBe(260);
    });
  });
});

describe("contract rules", () => {
  const contractOf = async (account: string) =>
    (await db.query<{ id: string }>("select id from public.contracts where account_id = $1", [account])).rows[0].id;

  it("cannot be activated without a late fee template", async () => {
    await expect(
      as(db, admin, async () => db.query("update public.contracts set status = 'active', quoted_basis = 'pre_tax' where id = $1", [await contractOf(ids.A.account)])),
    ).rejects.toThrow(/confirmed late fee template/);
  });

  it("cannot be activated with a template Pierce has not confirmed", async () => {
    await expect(
      as(db, admin, async () =>
        db.query(
          "update public.contracts set status = 'active', quoted_basis = 'pre_tax', late_fee_template_id = (select id from public.late_fee_templates limit 1) where id = $1",
          [await contractOf(ids.A.account)],
        ),
      ),
    ).rejects.toThrow(/confirmed late fee template/);
  });

  it("cannot be activated until the quoted basis is confirmed", async () => {
    await expect(
      as(db, admin, async () => {
        await db.query("update public.late_fee_templates set confirmed_at = now()");
        await db.query(
          "update public.contracts set status = 'active', late_fee_template_id = (select id from public.late_fee_templates limit 1) where id = $1",
          [await contractOf(ids.A.account)],
        );
      }),
    ).rejects.toThrow(/pre-tax or tax-inclusive/);
  });

  it("activates once the template is confirmed and the basis is set", async () => {
    await as(db, admin, async () => {
      await db.query("update public.late_fee_templates set confirmed_at = now()");
      const res = await db.query(
        "update public.contracts set status = 'active', quoted_basis = 'pre_tax', late_fee_template_id = (select id from public.late_fee_templates limit 1) where id = $1",
        [await contractOf(ids.A.account)],
      );
      expect(res.affectedRows).toBe(1);
    });
  });

  it("an invoiced phase cannot be changed or removed, only superseded", async () => {
    await expect(
      as(db, admin, () => db.query("update public.contract_phases set rate_per_unit_cents = 1300 where id = $1", [ids.A.phase])),
    ).rejects.toThrow(/has been invoiced/);
    await expect(
      as(db, admin, () => db.query("delete from public.contract_phases where id = $1", [ids.A.phase])),
    ).rejects.toThrow(/has been invoiced/);
    await as(db, admin, async () => {
      const res = await db.query("update public.contract_phases set superseded_at = now() where id = $1", [ids.A.phase]);
      expect(res.affectedRows).toBe(1);
    });
  });

  it("a property cannot have two active billing accounts", async () => {
    await expect(
      as(db, admin, () => db.query("insert into public.billing_accounts (property_id, customer_id) values ($1, $2)", [ids.A.property, ids.B.customer])),
    ).rejects.toThrow(/duplicate key/);
  });
});
