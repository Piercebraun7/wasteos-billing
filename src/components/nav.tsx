"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Four places. Everything else is a tab inside one of them.
const ITEMS = [
  { href: "/", label: "Home", match: [] as string[], icon: "M4 11l8-7 8 7v9h-5v-6H9v6H4z" },
  { href: "/review", label: "Invoices", match: ["/review", "/send", "/invoices", "/bulk"], icon: "M7 4h10v16l-2.5-1.5L12 20l-2.5-1.5L7 20zM10 9h4M10 13h4" },
  { href: "/accounts", label: "Properties", match: ["/accounts", "/schedule", "/contacts", "/increases"], icon: "M4 20V8l8-4 8 4v12M9 20v-6h6v6M4 20h16" },
  { href: "/settings", label: "Settings", match: ["/settings", "/items"], icon: "M12 9a3 3 0 100 6 3 3 0 000-6zM12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" },
];

export function Nav({ orientation }: { orientation: "vertical" | "horizontal" }) {
  const pathname = usePathname();
  const vertical = orientation === "vertical";
  return (
    <nav className={vertical ? "flex flex-col gap-1" : "flex gap-1 overflow-x-auto"}>
      {ITEMS.map((item) => {
        const active = item.href === "/" ? pathname === "/" : item.match.some((m) => pathname === m || pathname.startsWith(`${m}/`));
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`flex shrink-0 items-center gap-3 whitespace-nowrap rounded-xl px-3 py-2.5 text-[15px] font-medium transition ${
              active ? "bg-white/10 text-white" : "text-white/55 hover:bg-white/5 hover:text-white"
            }`}
          >
            <svg viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d={item.icon} />
            </svg>
            {item.label}
            {vertical && active && <span className="ml-auto size-1.5 rounded-full bg-tomato" aria-hidden />}
          </Link>
        );
      })}
    </nav>
  );
}
