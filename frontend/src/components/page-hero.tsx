import type { ReactNode } from "react";
import { IsoCity } from "@/components/iso-city";
import { cn } from "@/lib/utils";

/**
 * The head of every page: a bordered drafting panel with a "/// LABEL" caption, a heavy
 * display title and, on the right, a small isometric skyline (a different one per page).
 */
export function PageHero({
  label,
  title,
  seed,
  back,
  aside,
  compact = false,
  children,
}: {
  label: ReactNode;
  title: ReactNode;
  /** Which skyline to draw; keep one per page so each page has its own. */
  seed: number;
  /** A back link shown above the label. */
  back?: ReactNode;
  /** Shown on the right of the text on wide screens, e.g. report downloads. */
  aside?: ReactNode;
  /** A smaller title, for long text such as a finding's message. */
  compact?: boolean;
  children?: ReactNode;
}) {
  return (
    <section className="relative overflow-hidden border border-foreground/35 bg-card/60 px-6 py-6 sm:px-8 sm:py-8">
      <IsoCity
        seed={seed}
        size={6}
        // Sized by width, so a tall panel (long title) never pushes it under the text.
        className="pointer-events-none absolute right-0 bottom-0 w-[36%] max-w-md translate-x-[8%] translate-y-[12%] text-foreground/55 max-md:w-[70%] max-md:opacity-20"
      />
      <div className="relative space-y-3 md:max-w-[62%]">
        {back}
        <p className="slash-label">{label}</p>
        <h1
          className={cn(
            "font-display tracking-tight",
            // Thai tone marks and upper vowels need room above the line.
            compact
              ? "pt-1 text-xl leading-snug font-extrabold whitespace-pre-line sm:text-2xl"
              : "pt-2 text-4xl leading-tight font-black sm:text-5xl",
          )}
        >
          {title}
        </h1>
        {children}
        {aside}
      </div>
    </section>
  );
}
