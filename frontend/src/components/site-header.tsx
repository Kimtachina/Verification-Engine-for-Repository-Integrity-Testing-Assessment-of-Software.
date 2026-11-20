import Link from "next/link";
import { SiteNav } from "./site-nav";

/** A single isometric cube with one red face: the VERITAS mark. */
function CubeMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-6" aria-hidden fill="none" stroke="currentColor">
      <path d="M12 2.5 20.5 7.4v9.2L12 21.5l-8.5-4.9V7.4z" strokeWidth={1.25} />
      <path d="M3.5 7.4 12 12.3l8.5-4.9M12 12.3v9.2" strokeWidth={1.25} />
      <path d="M12 12.3 20.5 7.4v9.2L12 21.5z" fill="var(--signal)" stroke="none" />
    </svg>
  );
}

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-foreground/30 bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
        <Link href="/" className="flex items-center gap-2">
          <CubeMark />
          <span className="font-display text-lg font-black tracking-tight">VERITAS</span>
        </Link>
        <span className="slash-label hidden md:inline">Code Quality Verification</span>
        <SiteNav />
      </div>
    </header>
  );
}
