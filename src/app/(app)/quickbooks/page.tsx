import { headers } from "next/headers";
import { SettingsTabs } from "@/components/section-tabs";
import { SubmitButton } from "@/components/submit-button";
import { Card, dangerButton, inputClass, Notice, PageHeader, primaryButton, secondaryButton } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { connect, qboIsConfigured, redirectUri } from "@/lib/quickbooks/client";
import { disconnect, postAll, saveLinks } from "./actions";
import { SERVICE_KEYS, SERVICE_LABELS } from "./keys";

type QboCustomer = { Id: string; DisplayName: string; FullyQualifiedName?: string };
type QboItem = { Id: string; Name: string; FullyQualifiedName?: string };
type Account = { id: string; qbo_customer_id: string | null; property: { name: string }; customer: { name: string } };

const plain = (s: string) => s.toLowerCase().replace(/\b(the|at|village|of)\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim();

/** The QuickBooks customer whose name most plainly matches a property, if exactly one does. */
function suggestion(property: string, customers: QboCustomer[]): string {
  const want = plain(property);
  if (!want) return "";
  const hits = customers.filter((c) => {
    const leaf = plain((c.FullyQualifiedName ?? c.DisplayName).split(":").pop() ?? "");
    return leaf === want || leaf.includes(want) || want.includes(leaf);
  });
  return hits.length === 1 ? hits[0].Id : "";
}

export default async function QuickBooksPage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  const { supabase } = await requireAdmin();
  const { saved, error } = await searchParams;
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
  const configured = qboIsConfigured();
  const { data: row } = await supabase.from("qbo_connection").select("realm_id, company_name, connected_at, item_map").maybeSingle();

  const shell = (children: React.ReactNode) => (
    <div className="space-y-6">
      <PageHeader eyebrow="Set once" title="Settings" description="Approved invoices post to QuickBooks so your books match. The billing app sends the email; QuickBooks does not." />
      <SettingsTabs current="quickbooks" />
      {saved && <Notice kind="ok">{saved}</Notice>}
      {error && <Notice kind="error">{error}</Notice>}
      {children}
    </div>
  );

  if (!row) {
    return shell(
      <Card title="Connect QuickBooks" description={configured ? "The keys are in place. Click Connect, sign in to QuickBooks, and choose Kaizen Waste, LLC." : "Two keys from your Intuit developer app need to be added in Vercel before this button works."}>
        <div className="space-y-4">
          <div>
            <p className="text-sm font-medium text-ink">Redirect address to paste into your Intuit app</p>
            <p className="mt-1 select-all break-all rounded-xl border border-line bg-slate-50 px-3 py-2 font-mono text-sm text-ink">{redirectUri(origin)}</p>
          </div>
          {configured ? (
            <a href="/api/quickbooks/connect" className={primaryButton}>Connect QuickBooks</a>
          ) : (
            <p className="text-sm text-amber-700">Not ready yet: QBO_CLIENT_ID and QBO_CLIENT_SECRET are not set in Vercel.</p>
          )}
        </div>
      </Card>,
    );
  }

  const qbo = await connect(supabase);
  const [accountsRes, waitingRes] = await Promise.all([
    supabase.from("billing_accounts").select("id, qbo_customer_id, property:properties(name), customer:customers(name)").eq("status", "active"),
    supabase.from("invoices").select("id", { count: "exact", head: true }).in("status", ["approved", "sent", "partially_paid", "paid"]).is("qbo_invoice_id", null).eq("origin", "app"),
  ]);
  const accounts = ((accountsRes.data ?? []) as unknown as Account[]).sort((a, b) => a.property.name.localeCompare(b.property.name));
  const waiting = waitingRes.count ?? 0;

  let customers: QboCustomer[] = [];
  let items: QboItem[] = [];
  let loadError: string | null = "error" in qbo ? qbo.error : null;
  if (!("error" in qbo)) {
    const [c, i] = await Promise.all([
      qbo.query<QboCustomer>("select Id, DisplayName, FullyQualifiedName from Customer where Active = true maxresults 1000"),
      qbo.query<QboItem>("select Id, Name, FullyQualifiedName from Item where Active = true maxresults 1000"),
    ]);
    if ("error" in c) loadError = c.error;
    else customers = [...c].sort((a, b) => (a.FullyQualifiedName ?? a.DisplayName).localeCompare(b.FullyQualifiedName ?? b.DisplayName));
    if ("error" in i) loadError = i.error;
    else items = [...i].sort((a, b) => a.Name.localeCompare(b.Name));
  }
  const itemMap = (row.item_map ?? {}) as Record<string, string>;
  const unlinked = accounts.filter((a) => !a.qbo_customer_id).length;

  return shell(
    <>
      <Card title="Connection">
        <p className="text-[15px] text-slate-700">
          Connected to <span className="font-semibold text-ink">{row.company_name ?? `company ${row.realm_id}`}</span>.
        </p>
        {loadError && <p className="mt-2 text-sm text-red-700">QuickBooks could not be read just now: {loadError}</p>}
        <div className="mt-4 flex flex-wrap gap-2">
          <a href="/api/quickbooks/connect" className={secondaryButton}>Reconnect</a>
          <form action={disconnect}>
            <SubmitButton className={dangerButton}>Disconnect</SubmitButton>
          </form>
        </div>
      </Card>

      {!loadError && (
        <form action={saveLinks} className="space-y-6">
          <Card title="Which QuickBooks product each service posts to" description="Every line on an invoice posts under the product for its service. Everything else is the catch-all and is required.">
            <div className="grid gap-3 sm:grid-cols-2">
              {SERVICE_KEYS.map((key) => (
                <label key={key} className="block">
                  <span className="mb-1 block text-sm font-medium text-ink">{SERVICE_LABELS[key]}</span>
                  <select name={`item_${key}`} defaultValue={itemMap[key] ?? ""} required={key === "other"} className={inputClass}>
                    <option value="">{key === "other" ? "Choose a product" : "Use the catch-all"}</option>
                    {items.map((i) => (
                      <option key={i.Id} value={i.Id}>{i.FullyQualifiedName ?? i.Name}</option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </Card>

          <Card
            title="Which QuickBooks customer each property posts to"
            description={`Each property posts to the customer it already has in QuickBooks, so nothing is duplicated. ${unlinked ? `${unlinked} not linked yet. Where exactly one name matched, it is suggested and marked: check each one before saving.` : "All linked."}`}
          >
            <ul className="divide-y divide-line">
              {accounts.map((a) => {
                const guess = a.qbo_customer_id ? "" : suggestion(a.property.name, customers);
                return (
                  <li key={a.id} className="grid items-center gap-2 py-3 sm:grid-cols-[1fr_1.2fr_auto]">
                    <span className="min-w-0">
                      <span className="block truncate text-[15px] font-medium text-ink">{a.property.name}</span>
                      <span className="block truncate text-sm text-mute">{a.customer.name}</span>
                    </span>
                    <select name={`customer_${a.id}`} defaultValue={a.qbo_customer_id ?? guess} aria-label={`QuickBooks customer for ${a.property.name}`} className={inputClass}>
                      <option value="">Not linked</option>
                      {customers.map((c) => (
                        <option key={c.Id} value={c.Id}>{c.FullyQualifiedName ?? c.DisplayName}</option>
                      ))}
                    </select>
                    <span className={`text-sm ${a.qbo_customer_id ? "text-emerald-700" : guess ? "text-amber-700" : "text-mute"}`}>
                      {a.qbo_customer_id ? "Linked" : guess ? "Suggested, not saved" : "Choose one"}
                    </span>
                  </li>
                );
              })}
            </ul>
            <div className="mt-4">
              <SubmitButton className={primaryButton}>Save links</SubmitButton>
            </div>
          </Card>
        </form>
      )}

      <Card title="Invoices waiting to post" description="An invoice posts on its own when it is approved. Anything that did not post, for example because a property was not linked yet, waits here.">
        <p className="text-[15px] text-slate-700">{waiting === 0 ? "Nothing waiting. Every approved invoice is in QuickBooks." : `${waiting} approved invoice${waiting === 1 ? " is" : "s are"} not in QuickBooks yet.`}</p>
        {waiting > 0 && (
          <form action={postAll} className="mt-3">
            <SubmitButton className={primaryButton}>Post them to QuickBooks</SubmitButton>
          </form>
        )}
      </Card>
    </>,
  );
}
