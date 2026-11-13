// Talks to QuickBooks Online. The app's Client ID and Client Secret live in
// Vercel environment variables; the tokens that keep the company connected
// live in the qbo_connection table, readable only by billing admins.
import type { SupabaseClient } from "@supabase/supabase-js";

const AUTHORIZE = "https://appcenter.intuit.com/connect/oauth2";
const TOKEN = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const SCOPE = "com.intuit.quickbooks.accounting";
const MINOR = "75";

export function qboIsConfigured(): boolean {
  return Boolean(process.env.QBO_CLIENT_ID && process.env.QBO_CLIENT_SECRET);
}

const apiBase = () =>
  process.env.QBO_ENVIRONMENT === "sandbox" ? "https://sandbox-quickbooks.api.intuit.com" : "https://quickbooks.api.intuit.com";

/** The address QuickBooks sends the person back to after they approve the connection. */
export const redirectUri = (origin: string) => `${origin}/api/quickbooks/callback`;

export function authorizeUrl(origin: string, state: string): string {
  const q = new URLSearchParams({
    client_id: process.env.QBO_CLIENT_ID ?? "",
    response_type: "code",
    scope: SCOPE,
    redirect_uri: redirectUri(origin),
    state,
  });
  return `${AUTHORIZE}?${q}`;
}

type TokenReply = { access_token: string; refresh_token: string; expires_in: number; x_refresh_token_expires_in: number };

async function tokenRequest(body: Record<string, string>): Promise<TokenReply | { error: string }> {
  const basic = Buffer.from(`${process.env.QBO_CLIENT_ID}:${process.env.QBO_CLIENT_SECRET}`).toString("base64");
  try {
    const res = await fetch(TOKEN, {
      method: "POST",
      headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams(body),
      cache: "no-store",
    });
    const json = (await res.json().catch(() => ({}))) as Partial<TokenReply> & { error?: string; error_description?: string };
    if (!res.ok || !json.access_token || !json.refresh_token) return { error: json.error_description ?? json.error ?? `QuickBooks answered with status ${res.status}.` };
    return json as TokenReply;
  } catch (e) {
    return { error: e instanceof Error ? e.message : "QuickBooks could not be reached." };
  }
}

const expiries = (t: TokenReply) => ({
  access_token: t.access_token,
  refresh_token: t.refresh_token,
  // A minute of slack so a token is never used in its last seconds.
  access_expires_at: new Date(Date.now() + (t.expires_in - 60) * 1000).toISOString(),
  refresh_expires_at: new Date(Date.now() + t.x_refresh_token_expires_in * 1000).toISOString(),
});

/** Finishes the connection after the person approves it in QuickBooks. */
export async function completeConnection(supabase: SupabaseClient, origin: string, code: string, realmId: string): Promise<string | null> {
  const tokens = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri(origin) });
  if ("error" in tokens) return tokens.error;
  const existing = await supabase.from("qbo_connection").select("id, realm_id").maybeSingle();
  if (existing.data && existing.data.realm_id !== realmId) {
    return "A different QuickBooks company is already connected. Disconnect it first, so invoices are never posted to the wrong books.";
  }
  const write = existing.data
    ? await supabase.from("qbo_connection").update(expiries(tokens)).eq("singleton", true)
    : await supabase.from("qbo_connection").insert({ realm_id: realmId, ...expiries(tokens) });
  if (write.error) return write.error.message;
  const qbo = await connect(supabase);
  if (!("error" in qbo)) {
    const info = await qbo.get<{ CompanyInfo?: { CompanyName?: string } }>(`/companyinfo/${realmId}`);
    if (!("error" in info) && info.CompanyInfo?.CompanyName) {
      await supabase.from("qbo_connection").update({ company_name: info.CompanyInfo.CompanyName }).eq("singleton", true);
    }
  }
  return null;
}

export type Qbo = {
  realmId: string;
  companyName: string | null;
  itemMap: Record<string, string>;
  get<T>(path: string): Promise<T | { error: string }>;
  query<T>(sql: string): Promise<T[] | { error: string }>;
  post<T>(path: string, body: unknown, requestId: string): Promise<T | { error: string }>;
};

/** Opens the stored connection, renewing its token when needed. */
export async function connect(supabase: SupabaseClient): Promise<Qbo | { error: string }> {
  if (!qboIsConfigured()) return { error: "QuickBooks is not set up yet. Add the Client ID and Client Secret in Vercel first." };
  const { data: row, error } = await supabase.from("qbo_connection").select("*").maybeSingle();
  if (error) return { error: error.message };
  if (!row) return { error: "QuickBooks is not connected yet. Connect it in Settings." };

  let access = row.access_token as string;
  if (new Date(row.access_expires_at).getTime() <= Date.now()) {
    if (new Date(row.refresh_expires_at).getTime() <= Date.now()) return { error: "The QuickBooks connection has expired. Connect it again in Settings." };
    const tokens = await tokenRequest({ grant_type: "refresh_token", refresh_token: row.refresh_token as string });
    if ("error" in tokens) return { error: `The QuickBooks connection could not be renewed: ${tokens.error} Connect it again in Settings.` };
    // QuickBooks hands back a new refresh token; the old one stops working, so it is saved before anything else.
    const saved = await supabase.from("qbo_connection").update(expiries(tokens)).eq("singleton", true);
    if (saved.error) return { error: saved.error.message };
    access = tokens.access_token;
  }

  const realmId = row.realm_id as string;
  const call = async <T>(path: string, init: RequestInit): Promise<T | { error: string }> => {
    const join = path.includes("?") ? "&" : "?";
    try {
      const res = await fetch(`${apiBase()}/v3/company/${realmId}${path}${join}minorversion=${MINOR}`, {
        ...init,
        headers: { Authorization: `Bearer ${access}`, Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}) },
        cache: "no-store",
      });
      const json = (await res.json().catch(() => ({}))) as { Fault?: { Error?: { Message?: string; Detail?: string }[] } };
      if (!res.ok || json.Fault) {
        const f = json.Fault?.Error?.[0];
        return { error: f ? [f.Message, f.Detail].filter(Boolean).join(": ") : `QuickBooks answered with status ${res.status}.` };
      }
      return json as T;
    } catch (e) {
      return { error: e instanceof Error ? e.message : "QuickBooks could not be reached." };
    }
  };

  return {
    realmId,
    companyName: (row.company_name as string | null) ?? null,
    itemMap: (row.item_map ?? {}) as Record<string, string>,
    get: (path) => call(path, { method: "GET" }),
    post: (path, body, requestId) => call(`${path}?requestid=${encodeURIComponent(requestId)}`, { method: "POST", body: JSON.stringify(body) }),
    async query<T>(sql: string) {
      const out = await call<{ QueryResponse?: Record<string, unknown> }>(`/query?query=${encodeURIComponent(sql)}`, { method: "GET" });
      if ("error" in out) return out;
      const lists = Object.values(out.QueryResponse ?? {}).filter(Array.isArray) as T[][];
      return lists[0] ?? [];
    },
  };
}
