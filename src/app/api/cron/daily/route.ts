import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { daysInMonth, parts, todayInPhoenix } from "@/lib/billing/dates";
import { generateDrafts } from "@/lib/billing/drafts";
import { connect, qboIsConfigured } from "@/lib/quickbooks/client";
import { syncFromQuickBooks } from "@/lib/quickbooks/payments";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Runs once a day. It checks QuickBooks for payments and records them against
 * their invoices. In the last days of a month it also drafts that month's
 * invoices, so they are waiting for review about a week before the 1st.
 * Drafting is safe to repeat: anything already drafted is left alone.
 * Nothing is approved or sent by this job.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const serviceKey = process.env.SUPABASE_SECRET_KEY;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!secret || !serviceKey || !url) return new NextResponse("Not configured", { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) return new NextResponse("Unauthorized", { status: 401 });

  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });
  const today = todayInPhoenix();
  const { y, m, d } = parts(today);
  const { data: settings } = await supabase.from("app_settings").select("draft_days_before").maybeSingle();
  const daysBefore = settings?.draft_days_before ?? 7;
  const daysLeft = daysInMonth(y, m) - d + 1; // days until the 1st of next month

  // Every day: ask QuickBooks what has been paid, and bring in anything newly invoiced there.
  let quickbooks: unknown = "not connected";
  if (qboIsConfigured()) {
    const { count } = await supabase.from("qbo_connection").select("id", { count: "exact", head: true });
    if (count) {
      const qbo = await connect(supabase);
      quickbooks = "error" in qbo ? { error: qbo.error } : await syncFromQuickBooks(supabase, qbo);
    }
  }

  if (daysLeft > daysBefore) return NextResponse.json({ today, drafted: false, reason: `Drafting starts ${daysBefore} days before the 1st.`, quickbooks });

  try {
    const run = await generateDrafts(supabase, `${today.slice(0, 7)}-01`);
    return NextResponse.json({ today, drafted: true, created: run.created.length, skipped: run.skipped, quickbooks });
  } catch (e) {
    return NextResponse.json({ today, drafted: false, error: e instanceof Error ? e.message : "unknown error", quickbooks }, { status: 500 });
  }
}
