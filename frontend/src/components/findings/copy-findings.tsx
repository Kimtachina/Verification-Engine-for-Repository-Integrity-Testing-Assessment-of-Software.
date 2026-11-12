"use client";

import { DIMENSIONS, type Dimension, type FindingQueryInput, type Scan } from "@veritas/shared";
import { Check, Copy, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { projectName } from "@/components/scan/recent-scans";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";
import { copyText, fetchAllFindings, formatFindingsForCopy } from "@/lib/finding-copy";
import { dimensionLabel, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

type State = "idle" | "copying" | "copied" | "error";

/** One button: fetches every matching finding and copies them as Markdown. */
export function CopyFindingsButton({
  scan,
  query,
  title,
  label,
  count,
  className,
}: {
  scan: Scan;
  query: Omit<FindingQueryInput, "limit" | "offset">;
  title: string;
  label: string;
  count: number;
  className?: string;
}) {
  const [state, setState] = useState<State>("idle");

  useEffect(() => {
    if (state !== "copied" && state !== "error") return;
    const timer = setTimeout(() => setState("idle"), 2000);
    return () => clearTimeout(timer);
  }, [state]);

  const copy = async () => {
    setState("copying");
    try {
      const { items, total } = await fetchAllFindings((q) => api.findings(scan.id, q), query);
      await copyText(
        formatFindingsForCopy(items, { title, project: projectName(scan.root), total }),
      );
      setState("copied");
    } catch {
      setState("error");
    }
  };

  const Icon = state === "copying" ? Loader2 : state === "copied" ? Check : Copy;
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={copy}
      disabled={state === "copying" || count === 0}
      className={cn(state === "error" && "border-sev-high text-sev-high", className)}
    >
      <Icon className={cn(state === "copying" && "animate-spin")} aria-hidden />
      {state === "copied" ? "คัดลอกแล้ว" : state === "error" ? "คัดลอกไม่สำเร็จ" : label}
      <span className="text-muted-foreground tabular-nums">{formatNumber(count)}</span>
      <span className="sr-only" aria-live="polite">
        {state === "copied" ? "คัดลอกแล้ว" : state === "error" ? "คัดลอกไม่สำเร็จ" : ""}
      </span>
    </Button>
  );
}

const sum = (counts: Record<string, number>) => Object.values(counts).reduce((a, b) => a + b, 0);

/** A copy button for every dimension that found something, plus one for everything. */
export function CopyFindingsByDimension({ scan }: { scan: Scan }) {
  const withFindings = DIMENSIONS.map((d) => ({
    d,
    count: sum(scan.dimensions.find((x) => x.dimension === d)?.counts ?? {}),
  })).filter((x): x is { d: Dimension; count: number } => x.count > 0);
  if (withFindings.length === 0) return null;

  return (
    <section className="space-y-2" aria-label="คัดลอกปัญหาแยกตามมิติ">
      <h2 className="text-sm font-medium">
        คัดลอกปัญหาแยกตามมิติ
        <span className="ml-2 font-normal text-muted-foreground">
          เป็นข้อความ Markdown สำหรับวางใน issue แชต หรือให้ AI ช่วยแก้
        </span>
      </h2>
      <div className="flex flex-wrap gap-2">
        <CopyFindingsButton
          scan={scan}
          query={{}}
          title="VERITAS — ปัญหาทั้งหมด"
          label="ทั้งหมด"
          count={sum(scan.counts)}
        />
        {withFindings.map(({ d, count }) => (
          <CopyFindingsButton
            key={d}
            scan={scan}
            query={{ dimension: [d] }}
            title={`VERITAS — ${dimensionLabel(d)}`}
            label={dimensionLabel(d)}
            count={count}
          />
        ))}
      </div>
    </section>
  );
}
