import Link from "next/link";
import type { ReactNode } from "react";
import { Wordmark } from "@/components/ui";

export type Section = { heading: string; body: ReactNode[] };

/** Shared frame for the public legal pages. No sign-in is needed to read them. */
export function LegalPage({ title, effective, intro, sections, other }: { title: string; effective: string; intro: string; sections: Section[]; other: { href: string; label: string } }) {
  return (
    <main className="min-h-screen bg-white text-ink">
      <header className="bg-night px-6 py-6 sm:px-10">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <Wordmark light />
          <Link href="/login" className="font-mono text-[11px] uppercase tracking-[0.2em] text-white/60 hover:text-white">Sign in</Link>
        </div>
      </header>
      <article className="mx-auto max-w-3xl px-6 py-12 sm:px-10">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-tomato">Kaizen Waste billing</p>
        <h1 className="mt-3 text-4xl font-extrabold tracking-tight">{title}</h1>
        <p className="mt-2 text-sm text-mute">Effective {effective}</p>
        <p className="mt-6 text-[15px] leading-relaxed text-slate-700">{intro}</p>
        {sections.map((s, i) => (
          <section key={s.heading} className="mt-9">
            <h2 className="text-xl font-bold tracking-tight">{i + 1}. {s.heading}</h2>
            {s.body.map((p, j) => (
              <p key={j} className="mt-3 text-[15px] leading-relaxed text-slate-700">{p}</p>
            ))}
          </section>
        ))}
        <footer className="mt-12 border-t border-line pt-6 text-sm text-mute">
          <p>Kaizen Waste, LLC · 3459 E Pasadena Ave, Phoenix, AZ 85018 · (602) 341-5575 · invoices@kaizen-waste.com</p>
          <p className="mt-2"><Link href={other.href} className="font-medium text-ink underline">{other.label}</Link></p>
        </footer>
      </article>
    </main>
  );
}
