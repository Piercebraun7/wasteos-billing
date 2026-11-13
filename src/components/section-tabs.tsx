import type { SupabaseClient } from "@supabase/supabase-js";
import Link from "next/link";
import type { ReactNode } from "react";
import { primaryButton, secondaryButton } from "./ui";

type Tab = { key: string; href: string; label: string; count?: number };

/** The row of tabs under a section title, with that section's main buttons on the right. */
function Tabs({ tabs, current, children }: { tabs: Tab[]; current: string; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap gap-1 rounded-full border border-line bg-white p-1">
        {tabs.map((t) => {
          const active = t.key === current;
          return (
            <Link
              key={t.key}
              href={t.href}
              aria-current={active ? "page" : undefined}
              className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition ${active ? "bg-ink text-white" : "text-slate-600 hover:bg-slate-100"}`}
            >
              {t.label}
              {t.count !== undefined && t.count > 0 && (
                <span className={`rounded-full px-1.5 text-xs tabular-nums ${active ? "bg-white/20 text-white" : "bg-tomato text-white"}`}>{t.count}</span>
              )}
            </Link>
          );
        })}
      </div>
      {children && <div className="flex flex-wrap gap-2">{children}</div>}
    </div>
  );
}

/** Invoices: prepare them, ship them, see what is owed. */
export async function InvoiceTabs({ supabase, current }: { supabase: SupabaseClient; current: "review" | "send" | "unpaid" | "paid" | "none" }) {
  const [drafts, approved] = await Promise.all([
    supabase.from("invoices").select("id", { count: "exact", head: true }).eq("status", "draft"),
    supabase.from("invoices").select("id", { count: "exact", head: true }).eq("status", "approved"),
  ]);
  return (
    <Tabs
      current={current}
      tabs={[
        { key: "review", href: "/review", label: "1. Review", count: drafts.count ?? 0 },
        { key: "send", href: "/send", label: "2. Send", count: approved.count ?? 0 },
        { key: "unpaid", href: "/invoices?view=unpaid", label: "Unpaid" },
        { key: "paid", href: "/invoices?view=paid", label: "Paid" },
      ]}
    >
      <Link href="/bulk" className={secondaryButton}>Enter bulk pickups</Link>
      <Link href="/invoices/new" className={primaryButton}>Create invoice</Link>
    </Tabs>
  );
}

/** Properties: the list, the schedule of billing, and who gets the invoices. */
export function PropertyTabs({ current }: { current: "list" | "schedule" | "contacts" | "increases" }) {
  return (
    <Tabs
      current={current}
      tabs={[
        { key: "list", href: "/accounts", label: "List" },
        { key: "schedule", href: "/schedule", label: "Schedule of billing" },
        { key: "contacts", href: "/contacts", label: "Contacts" },
        { key: "increases", href: "/increases", label: "Rate increases" },
      ]}
    >
      <Link href="/accounts/new?next=schedule" className={primaryButton}>Add a property</Link>
    </Tabs>
  );
}

export function SettingsTabs({ current }: { current: "general" | "items" | "templates" | "quickbooks" }) {
  return (
    <Tabs
      current={current}
      tabs={[
        { key: "general", href: "/settings", label: "General" },
        { key: "items", href: "/items", label: "Products and services" },
        { key: "templates", href: "/templates", label: "Invoice templates" },
        { key: "quickbooks", href: "/quickbooks", label: "QuickBooks" },
      ]}
    />
  );
}
