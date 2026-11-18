"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type Turn = { role: "user" | "assistant"; text: string; failed?: boolean };

const STARTERS = ["Who owes us the most right now?", "What is waiting to go out?", "How do I add a can replacement to a draft?"];

/** Turns in-app paths in a reply (for example /invoices/…) into links, and leaves everything else as plain text. */
function withLinks(text: string) {
  const parts = text.split(/(\/(?:invoices|customers|accounts)\/[0-9a-f-]{36}|\/(?:review|send|outbox|settings|templates|quickbooks|schedule|contacts|increases|bulk|items|customers|accounts)\b)/g);
  return parts.map((part, i) =>
    /^\/[a-z]/.test(part) ? (
      <Link key={i} href={part} className="font-medium text-ink underline underline-offset-2">
        {part.startsWith("/invoices/") ? "open invoice" : part.startsWith("/customers/") ? "open account" : part.startsWith("/accounts/") ? "open property" : part}
      </Link>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

/** The billing assistant: a button in the corner that opens a chat. The conversation lives only in this browser tab. */
export function Assistant({ connected }: { connected: boolean }) {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [turns, busy, open]);

  async function ask(question: string) {
    const text = question.trim();
    if (!text || busy) return;
    const next: Turn[] = [...turns, { role: "user", text }];
    setTurns(next);
    setDraft("");
    setBusy(true);
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ history: next.filter((t) => !t.failed).map(({ role, text: t }) => ({ role, text: t })) }),
      });
      const body = (await res.json().catch(() => ({}))) as { reply?: string; error?: string };
      setTurns([...next, body.reply ? { role: "assistant", text: body.reply } : { role: "assistant", text: body.error ?? "Something went wrong. Try again.", failed: true }]);
    } catch {
      setTurns([...next, { role: "assistant", text: "The assistant could not be reached. Check your connection and try again.", failed: true }]);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="fixed bottom-5 right-5 z-30 flex h-12 items-center gap-2 rounded-full bg-ink px-5 text-sm font-semibold text-white shadow-xl transition hover:-translate-y-0.5">
        <span className="size-2 rounded-full bg-tomato" aria-hidden /> Ask
      </button>
    );
  }
  return (
    <section aria-label="Billing assistant" className="fixed inset-x-3 bottom-3 z-30 flex max-h-[80vh] flex-col overflow-hidden rounded-3xl border border-line bg-white shadow-2xl sm:inset-x-auto sm:right-5 sm:bottom-5 sm:w-[420px]">
      <header className="flex items-center justify-between bg-ink px-5 py-3.5 text-white">
        <div>
          <p className="text-sm font-semibold">Billing assistant</p>
          <p className="text-xs text-white/55">Looks things up and prepares drafts. It cannot approve or send.</p>
        </div>
        <div className="flex gap-1">
          {turns.length > 0 && <button onClick={() => setTurns([])} className="rounded-full px-2.5 py-1 text-xs text-white/70 hover:bg-white/10">Clear</button>}
          <button onClick={() => setOpen(false)} aria-label="Close the assistant" className="rounded-full px-2.5 py-1 text-xs text-white/70 hover:bg-white/10">Close</button>
        </div>
      </header>
      <div className="flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite">
        {!connected && <p className="rounded-2xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-900">Not switched on yet. It needs a key added in Vercel.</p>}
        {turns.length === 0 && connected && (
          <div className="space-y-2">
            <p className="text-sm text-mute">Ask about what is owed, an account, or how to do something. Or ask it to draft an invoice.</p>
            {STARTERS.map((s) => (
              <button key={s} onClick={() => ask(s)} className="block w-full rounded-2xl border border-line px-3.5 py-2.5 text-left text-sm text-slate-700 transition hover:bg-slate-50">{s}</button>
            ))}
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} className={t.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <p className={`max-w-[88%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-[15px] leading-relaxed ${t.role === "user" ? "bg-ink text-white" : t.failed ? "border border-red-200 bg-red-50 text-red-800" : "bg-slate-100 text-slate-800"}`}>
              {t.role === "assistant" && !t.failed ? withLinks(t.text) : t.text}
            </p>
          </div>
        ))}
        {busy && <p className="text-sm text-mute">Looking that up...</p>}
        <div ref={end} />
      </div>
      <form onSubmit={(e) => { e.preventDefault(); ask(draft); }} className="flex items-end gap-2 border-t border-line p-3">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(draft); } }}
          rows={2}
          placeholder="Ask a question"
          aria-label="Your question"
          disabled={!connected}
          className="min-h-11 flex-1 resize-none rounded-2xl border border-line px-3.5 py-2.5 text-[15px] outline-none focus:border-ink"
        />
        <button type="submit" disabled={busy || !draft.trim() || !connected} className="h-11 rounded-full bg-ink px-4 text-sm font-semibold text-white disabled:opacity-40">Send</button>
      </form>
    </section>
  );
}
