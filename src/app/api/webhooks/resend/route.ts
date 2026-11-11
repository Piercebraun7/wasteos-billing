import { createHmac, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Delivery updates from the email service (delivered, bounced, opened).
 * There is no signed-in person here, so the request must carry a valid
 * signature made with the webhook secret, or it is refused.
 */
function signatureIsValid(secret: string, id: string, timestamp: string, body: string, header: string): boolean {
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest();
  return header.split(" ").some((part) => {
    const given = Buffer.from(part.split(",")[1] ?? "", "base64");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

const COLUMN: Record<string, string> = {
  "email.delivered": "delivered_at",
  "email.bounced": "bounced_at",
  "email.opened": "opened_at",
};

export async function POST(request: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  const serviceKey = process.env.SUPABASE_SECRET_KEY;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!secret || !serviceKey || !url) return new NextResponse("Not configured", { status: 503 });

  const body = await request.text();
  const id = request.headers.get("svix-id") ?? "";
  const timestamp = request.headers.get("svix-timestamp") ?? "";
  const signature = request.headers.get("svix-signature") ?? "";
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!id || !timestamp || !(age < 300) || !signatureIsValid(secret, id, timestamp, body, signature)) {
    return new NextResponse("Invalid signature", { status: 401 });
  }

  const event = JSON.parse(body) as { type?: string; created_at?: string; data?: { email_id?: string } };
  const column = COLUMN[event.type ?? ""];
  const messageId = event.data?.email_id;
  if (!column || !messageId) return NextResponse.json({ ignored: true });

  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { error } = await supabase
    .from("email_sends")
    .update({ [column]: event.created_at ?? new Date().toISOString() })
    .eq("provider_message_id", messageId)
    .is(column, null);
  if (error) return new NextResponse(error.message, { status: 500 });
  return NextResponse.json({ ok: true });
}
