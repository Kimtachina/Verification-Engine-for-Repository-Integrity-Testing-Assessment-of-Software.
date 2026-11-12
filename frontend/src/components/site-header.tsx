import { ShieldCheck } from "lucide-react";
import Link from "next/link";
import { SiteNav } from "./site-nav";

export function SiteHeader() {
  return (
    <header className="border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-40">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <ShieldCheck className="size-5" aria-hidden />
          <span>VERITAS</span>
        </Link>
        <span className="hidden text-sm text-muted-foreground md:inline">
          ตรวจคุณภาพโค้ดแบบละเอียด 10 มิติ
        </span>
        <SiteNav />
      </div>
    </header>
  );
}
