"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/", label: "Dashboard", icon: "M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z" },
  { href: "/accounts", label: "Clients", icon: "M4 20V8l8-4 8 4v12M9 20v-6h6v6M4 20h16" },
  { href: "/schedule", label: "Schedule of billing", icon: "M4 6h16v14H4zM4 10h16M9 6v14M15 6v14" },
  { href: "/bulk", label: "Bulk trash", icon: "M5 8h14l-1.2 11H6.2zM9 8V5h6v3M3 8h18" },
  { href: "/invoices/new", label: "Create invoice", icon: "M12 5v14M5 12h14" },
  { href: "/review", label: "Review queue", icon: "M5 4h14v16H5zM9 9h6M9 13h6M9 17h3" },
  { href: "/invoices", label: "Invoices", icon: "M7 4h10v16l-2.5-1.5L12 20l-2.5-1.5L7 20zM10 9h4M10 13h4" },
  { href: "/send", label: "Send", icon: "M4 12l16-8-6 16-3-7z" },
  { href: "/contacts", label: "Contacts", icon: "M4 6h16v12H4zM4 7l8 6 8-6" },
  { href: "/items", label: "Products and services", icon: "M5 5h6v6H5zM13 5h6v6h-6zM5 13h6v6H5zM13 13h6v6h-6z" },
];

export function Nav({ orientation }: { orientation: "vertical" | "horizontal" }) {
  const pathname = usePathname();
  const vertical = orientation === "vertical";
  return (
    <nav className={vertical ? "flex flex-col gap-1" : "flex gap-1 overflow-x-auto"}>
      {ITEMS.map((item) => {
        const active =
          item.href === "/"
            ? pathname === "/"
            : item.href === "/invoices"
              ? pathname === "/invoices" || (pathname.startsWith("/invoices/") && !pathname.startsWith("/invoices/new"))
              : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`flex shrink-0 items-center gap-3 whitespace-nowrap rounded-xl px-3 py-2.5 text-sm font-medium transition ${
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
