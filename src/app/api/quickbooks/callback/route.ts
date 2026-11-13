import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { completeConnection } from "@/lib/quickbooks/client";

export const runtime = "nodejs";

/** QuickBooks sends the person back here after they approve (or refuse) the connection. */
export async function GET(request: Request) {
  const { supabase } = await requireAdmin();
  const url = new URL(request.url);
  const back = (kind: "saved" | "error", message: string) => {
    const response = NextResponse.redirect(`${url.origin}/quickbooks?${kind}=${encodeURIComponent(message)}`);
    response.cookies.delete({ name: "qbo_state", path: "/api/quickbooks" });
    return response;
  };
  const expected = (await cookies()).get("qbo_state")?.value;
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const realmId = url.searchParams.get("realmId");
  if (url.searchParams.get("error")) return back("error", "The connection was not approved in QuickBooks. Nothing was changed.");
  if (!expected || !state || expected !== state) return back("error", "That connection attempt could not be verified. Click Connect and try again.");
  if (!code || !realmId) return back("error", "QuickBooks did not send back what was needed. Click Connect and try again.");
  const problem = await completeConnection(supabase, url.origin, code, realmId);
  if (problem) return back("error", problem);
  return back("saved", "QuickBooks is connected. Next, link each property and choose the products below.");
}
