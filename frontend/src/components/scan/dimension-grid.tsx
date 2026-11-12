import { DIMENSION_META, type Dimension, type Scan } from "@veritas/shared";
import { CircleSlash, XCircle } from "lucide-react";
import Link from "next/link";
import { SeverityCountsRow } from "@/components/findings/severity-badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { dimensionLabel, gradeTone } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * One card per dimension: score and grade, or why it was not scored. When `hrefFor` is
 * given, each card links to the findings filtered to that dimension.
 */
export function DimensionGrid({
  scan,
  hrefFor,
}: {
  scan: Scan;
  hrefFor?: (d: Dimension) => string;
}) {
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
      {scan.dimensions.map((d) => {
        const run = scan.analyzers.find((a) => a.dimension === d.dimension);
        const body = (
          <div
            className={cn(
              "flex h-full flex-col gap-2 rounded-xl border bg-card p-4 transition-colors",
              hrefFor && "hover:border-foreground/30 hover:bg-muted/40",
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <span className="font-medium leading-snug">{dimensionLabel(d.dimension)}</span>
              {d.grade && (
                <span className={cn("text-sm font-semibold", gradeTone(d.grade))}>{d.grade}</span>
              )}
            </div>
            {d.score !== null ? (
              <>
                <span className="text-2xl font-semibold tabular-nums">{Math.round(d.score)}</span>
                <SeverityCountsRow counts={d.counts} className="text-xs" />
              </>
            ) : (
              <span className="flex items-start gap-1.5 text-sm text-muted-foreground">
                {run?.status === "failed" ? (
                  <XCircle className="mt-0.5 size-4 shrink-0 text-sev-high" aria-hidden />
                ) : (
                  <CircleSlash className="mt-0.5 size-4 shrink-0" aria-hidden />
                )}
                <span className="line-clamp-3">
                  {run?.status === "failed" ? "ล้มเหลว: " : "ข้าม: "}
                  {run?.reason}
                </span>
              </span>
            )}
            {d.score !== null && run?.reason && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="mt-auto cursor-help text-xs text-muted-foreground underline decoration-dotted">
                    มีหมายเหตุ
                  </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">{run.reason}</TooltipContent>
              </Tooltip>
            )}
          </div>
        );
        return (
          <li key={d.dimension} title={DIMENSION_META[d.dimension].description}>
            {hrefFor && d.score !== null ? (
              <Link
                href={hrefFor(d.dimension)}
                className="block h-full rounded-xl focus-visible:outline-2"
              >
                {body}
              </Link>
            ) : (
              body
            )}
          </li>
        );
      })}
    </ul>
  );
}
