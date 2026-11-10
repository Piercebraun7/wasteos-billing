"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

/** A form button that switches itself off while its form is being saved, so a second click does nothing. */
export function SubmitButton({ className, children }: { className: string; children: ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} aria-busy={pending} className={`${className} disabled:cursor-not-allowed disabled:opacity-50`}>
      {pending ? "Working..." : children}
    </button>
  );
}
