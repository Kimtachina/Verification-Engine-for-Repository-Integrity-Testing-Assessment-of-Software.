"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const LINKS = [
  {
    href: "/",
    label: "ภาพรวม",
    match: (p: string) => p === "/" || p.startsWith("/scans") || p.startsWith("/findings"),
  },
  {
    href: "/history",
    label: "ประวัติ",
    match: (p: string) => p.startsWith("/history") || p.startsWith("/compare"),
  },
  { href: "/settings", label: "ตั้งค่า", match: (p: string) => p.startsWith("/settings") },
];

export function SiteNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="เมนูหลัก" className="ml-auto flex gap-1">
      {LINKS.map((link) => {
        const active = link.match(pathname);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "border-b-2 px-3 py-1.5 text-sm font-medium transition-colors",
              active
                ? "border-signal text-foreground"
                : "border-transparent text-muted-foreground hover:border-foreground/40 hover:text-foreground",
            )}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
