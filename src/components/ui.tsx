import type { ReactNode } from "react";

export const inputClass =
  "h-11 w-full rounded-xl border border-line bg-white px-3.5 text-[15px] text-ink placeholder:text-slate-400 outline-none transition focus:border-ink focus:ring-4 focus:ring-ink/10";
const buttonBase =
  "inline-flex h-11 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-full px-5 text-sm font-medium transition active:scale-[0.98]";
export const primaryButton = `${buttonBase} bg-ink text-white shadow-sm hover:bg-black`;
export const secondaryButton = `${buttonBase} border border-line bg-white text-ink hover:border-slate-300 hover:bg-slate-50`;
export const dangerButton = `${buttonBase} px-4 text-red-600 hover:bg-red-50`;

/** Small uppercase technical label. */
export function Eyebrow({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <p className={`font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-mute ${className}`}>{children}</p>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <Eyebrow>{eyebrow}</Eyebrow>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">{title}</h1>
        {description && <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-mute">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
  className = "",
  needed = false,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
  needed?: boolean;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1.5 block text-[13px] font-medium text-slate-600">
        {label}
        {needed && <Needed />}
      </span>
      {children}
      {hint && <span className="mt-1.5 block text-xs leading-relaxed text-mute">{hint}</span>}
    </label>
  );
}

export function Card({
  title,
  description,
  children,
  needed = false,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  needed?: boolean;
}) {
  return (
    <section className="rounded-3xl border border-line bg-white p-5 shadow-[0_1px_2px_rgb(16_24_40/0.04)] sm:p-7">
      <h2 className="text-lg font-semibold tracking-tight text-ink">
        {title}
        {needed && <Needed />}
      </h2>
      {description && <p className="mt-1 max-w-2xl text-sm leading-relaxed text-mute">{description}</p>}
      <div className="mt-5">{children}</div>
    </section>
  );
}

export function Stat({ label, value, detail, dark = false }: { label: string; value: string; detail?: string; dark?: boolean }) {
  return (
    <div
      className={
        dark
          ? "relative overflow-hidden rounded-3xl bg-ink p-6 text-white"
          : "rounded-3xl border border-line bg-white p-6 shadow-[0_1px_2px_rgb(16_24_40/0.04)]"
      }
    >
      {dark && <div className="grid-lines pointer-events-none absolute inset-0" aria-hidden />}
      <div className="relative">
        <Eyebrow className={dark ? "!text-white/60" : ""}>{label}</Eyebrow>
        <p className="font-display mt-3 text-3xl font-bold tracking-tight tabular-nums sm:text-4xl">{value}</p>
        {detail && <p className={`mt-2 text-sm ${dark ? "text-white/60" : "text-mute"}`}>{detail}</p>}
      </div>
    </div>
  );
}

export function Notice({ kind, children }: { kind: "error" | "ok" | "info"; children: ReactNode }) {
  const styles = {
    error: "border-red-200 bg-red-50 text-red-800",
    ok: "border-emerald-200 bg-emerald-50 text-emerald-800",
    info: "border-amber-200 bg-amber-50 text-amber-900",
  }[kind];
  const dot = { error: "bg-red-500", ok: "bg-emerald-500", info: "bg-amber-500" }[kind];
  return (
    <p role={kind === "error" ? "alert" : "status"} className={`flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm leading-relaxed ${styles}`}>
      <span className={`mt-1.5 size-2 shrink-0 rounded-full ${dot}`} aria-hidden />
      <span>{children}</span>
    </p>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-3xl border border-dashed border-slate-300 bg-white/60 px-6 py-14 text-center text-[15px] text-mute">
      {children}
    </div>
  );
}

/** Square monogram used beside a property name. */
export function Monogram({ name }: { name: string }) {
  const letters = name
    .replace(/^(the|village at)\s+/i, "")
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  return (
    <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-ice font-mono text-[13px] font-semibold text-ink" aria-hidden>
      {letters}
    </span>
  );
}

export function Wordmark({ light = false }: { light?: boolean }) {
  return (
    <span className="flex items-end gap-2.5">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={light ? "/brand/kaizen-waste-logo-white.svg" : "/brand/kaizen-waste-logo.svg"}
        alt="Kaizen Waste"
        width={105}
        height={40}
        className="h-10 w-auto"
      />
      <span className={`pb-[3px] font-mono text-[10px] font-medium uppercase tracking-[0.18em] ${light ? "text-white/50" : "text-mute"}`}>
        Billing
      </span>
    </span>
  );
}

/** Red asterisk marking something that is still needed. */
export function Needed() {
  return (
    <span className="ml-1 font-semibold text-red-600" aria-label="needed">
      *
    </span>
  );
}
