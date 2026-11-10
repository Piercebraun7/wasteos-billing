import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

// A real Postgres running in memory. We add the few things Supabase provides
// (the three roles and the auth helpers), then apply the project's migrations
// exactly as they will run on the live database.
const SUPABASE_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create function auth.jwt() returns jsonb language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
  $$;
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(auth.jwt() ->> 'sub', '')::uuid
  $$;
  grant usage on schema auth, public to anon, authenticated, service_role;
  grant execute on all functions in schema auth to anon, authenticated, service_role;
  -- Mimic Supabase: by default every new table is open to all three roles.
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
`;

export async function createDatabase(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SUPABASE_STUB);
  const dir = join(__dirname, "..", "supabase", "migrations");
  for (const file of readdirSync(dir).sort()) {
    await db.exec(readFileSync(join(dir, file), "utf8"));
  }
  return db;
}

export type Identity =
  | { role: "anon" }
  | { role: "authenticated"; claims: Record<string, unknown> };

// Runs the callback as the given identity, then rolls everything back.
export async function as<T>(
  db: PGlite,
  who: Identity,
  fn: (db: PGlite) => Promise<T>,
  { commit = false } = {},
): Promise<T> {
  await db.exec("begin");
  try {
    const claims = who.role === "authenticated" ? who.claims : {};
    await db.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify(claims),
    ]);
    await db.exec(`set local role ${who.role}`);
    const result = await fn(db);
    await db.exec(commit ? "commit" : "rollback");
    return result;
  } catch (error) {
    await db.exec("rollback");
    throw error;
  }
}

export async function count(db: PGlite, table: string): Promise<number> {
  const res = await db.query<{ n: number }>(
    `select count(*)::int as n from public.${table}`,
  );
  return res.rows[0].n;
}
