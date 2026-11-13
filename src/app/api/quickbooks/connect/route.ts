import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { authorizeUrl, qboIsConfigured } from "@/lib/quickbooks/client";

export const runtime = "nodejs";

/** Sends a signed-in admin to QuickBooks to approve the connection. */
export async function GET(request: Request) {
  await requireAdmin();
  const origin = new URL(request.url).origin;
  if (!qboIsConfigured()) return NextResponse.redirect(`${origin}/quickbooks?error=${encodeURIComponent("Add the QuickBooks Client ID and Client Secret in Vercel first.")}`);
  // A one-time value, checked when QuickBooks sends the person back, so nobody else can finish this connection.
  const state = randomBytes(24).toString("hex");
  const response = NextResponse.redirect(authorizeUrl(origin, state));
  response.cookies.set("qbo_state", state, { httpOnly: true, secure: true, sameSite: "lax", path: "/api/quickbooks", maxAge: 600 });
  return response;
}
