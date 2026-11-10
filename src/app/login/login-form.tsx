"use client";

import { useActionState } from "react";
import { signIn } from "./actions";

const field =
  "h-12 w-full rounded-xl border border-white/10 bg-white/[0.06] px-4 text-[15px] text-white placeholder:text-white/30 outline-none transition focus:border-white/40 focus:bg-white/10 focus:ring-4 focus:ring-white/10";
const label = "mb-1.5 block font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-white/50";

export function LoginForm() {
  const [state, action, pending] = useActionState(signIn, undefined);
  return (
    <form action={action} className="space-y-4">
      <label className="block">
        <span className={label}>Email</span>
        <input name="email" type="email" autoComplete="email" required className={field} />
      </label>
      <label className="block">
        <span className={label}>Password</span>
        <input name="password" type="password" autoComplete="current-password" required className={field} />
      </label>
      {state?.error && (
        <p role="alert" className="rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {state.error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="h-12 w-full rounded-full bg-white text-[15px] font-semibold text-night transition hover:bg-white/90 active:scale-[0.99] disabled:opacity-60"
      >
        {pending ? "Signing in..." : "Continue"}
      </button>
    </form>
  );
}
