import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { daysInMonth, parts, todayInPhoenix } from "@/lib/billing/dates";
import { generateDrafts } from "@/lib/billing/drafts";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Runs once a day. In the last days of a month it drafts that month's
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
  if (daysLeft > daysBefore) return NextResponse.json({ today, drafted: false, reason: `Drafting starts ${daysBefore} days before the 1st.` });

  try {
    const run = await generateDrafts(supabase, `${today.slice(0, 7)}-01`);
    return NextResponse.json({ today, drafted: true, created: run.created.length, skipped: run.skipped });
  } catch (e) {
    return NextResponse.json({ today, drafted: false, error: e instanceof Error ? e.message : "unknown error" }, { status: 500 });
  }
}
