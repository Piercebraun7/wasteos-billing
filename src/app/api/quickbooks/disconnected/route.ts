import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";

export const runtime = "nodejs";

/**
 * QuickBooks sends the person here after they disconnect the app from inside
 * QuickBooks. The stored connection no longer works, so it is removed and the
 * QuickBooks settings page says so. Property links are kept.
 */
export async function GET(request: Request) {
  const { supabase } = await requireAdmin();
  const origin = new URL(request.url).origin;
  const { error } = await supabase.from("qbo_connection").delete().eq("singleton", true);
  const message = error ? error.message : "QuickBooks was disconnected. Nothing in QuickBooks was changed, and the property links are kept. Click Connect to link it again.";
  return NextResponse.redirect(`${origin}/quickbooks?${error ? "error" : "saved"}=${encodeURIComponent(message)}`);
}
