import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ASSISTANT_GUIDE } from "./guide";
import { assistantTools } from "./tools";

export type ChatTurn = { role: "user" | "assistant"; text: string };

export function assistantIsConnected(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/**
 * Answers one question. The model call lives in this one file, so the
 * provider can be changed later without touching the tools or the screen.
 * The model can be changed without a code change through ASSISTANT_MODEL.
 */
export async function askAssistant(supabase: SupabaseClient, history: ChatTurn[], today: string, askedBy: string): Promise<{ reply: string } | { error: string }> {
  if (!assistantIsConnected()) return { error: "The assistant is not switched on yet. Add ANTHROPIC_API_KEY in Vercel first." };
  const client = new Anthropic();
  const messages: Anthropic.Beta.BetaMessageParam[] = history.slice(-24).map((t) => ({ role: t.role, content: t.text.slice(0, 6000) }));
  if (messages.length === 0 || messages[messages.length - 1].role !== "user") return { error: "Ask a question first." };

  try {
    const final = await client.beta.messages.toolRunner({
      model: process.env.ASSISTANT_MODEL?.trim() || "claude-sonnet-5-5",
      max_tokens: 16000,
      max_iterations: 12,
      output_config: { effort: "medium" },
      // If the model declines a request for policy reasons, a substitute model answers instead of the question just failing.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: [
        // The fixed guide first, so it is reused between questions; the date and name change, so they come after.
        { type: "text", text: ASSISTANT_GUIDE, cache_control: { type: "ephemeral" } },
        { type: "text", text: `Today is ${today} (Phoenix time). You are talking with ${askedBy || "one of the owners"}.` },
      ],
      tools: assistantTools(supabase, today),
      messages,
    });
    if (final.stop_reason === "refusal") return { error: "The assistant declined to answer that. Try asking it another way." };
    if (final.stop_reason === "max_tokens") return { error: "That answer ran too long. Ask for something narrower." };
    const reply = final.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("\n").trim();
    if (!reply) return { error: "The assistant looked things up but did not finish an answer. Ask again, or ask something narrower." };
    return { reply };
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return { error: "The assistant's key was not accepted. Check ANTHROPIC_API_KEY in Vercel." };
    if (e instanceof Anthropic.RateLimitError) return { error: "The assistant is busy right now. Try again in a minute." };
    if (e instanceof Anthropic.BadRequestError) return { error: `The assistant could not take that request: ${e.message}` };
    if (e instanceof Anthropic.APIConnectionError) return { error: "The assistant could not be reached. Try again." };
    if (e instanceof Anthropic.APIError) return { error: `The assistant had a problem (${e.status ?? "unknown"}). Try again.` };
    return { error: e instanceof Error ? e.message : "The assistant had a problem. Try again." };
  }
}
