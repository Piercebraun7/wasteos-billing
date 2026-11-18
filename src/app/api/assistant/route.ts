import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { askAssistant, type ChatTurn } from "@/lib/assistant/run";
import { todayInPhoenix } from "@/lib/billing/dates";

export const runtime = "nodejs";
export const maxDuration = 120;

/** One question to the billing assistant. Only a signed-in owner can ask, and the conversation is not stored. */
export async function POST(request: Request) {
  const { supabase, name } = await requireAdmin();
  let body: { history?: unknown } = {};
  try {
    body = (await request.json()) as { history?: unknown };
  } catch {
    return NextResponse.json({ error: "That request could not be read." }, { status: 400 });
  }
  const history: ChatTurn[] = (Array.isArray(body.history) ? body.history : [])
    .filter((t): t is ChatTurn => Boolean(t) && typeof t === "object" && ((t as ChatTurn).role === "user" || (t as ChatTurn).role === "assistant") && typeof (t as ChatTurn).text === "string" && (t as ChatTurn).text.trim() !== "")
    .map((t) => ({ role: t.role, text: t.text }));
  const result = await askAssistant(supabase, history, todayInPhoenix(), name.split(" ")[0] ?? "");
  return NextResponse.json(result);
}
