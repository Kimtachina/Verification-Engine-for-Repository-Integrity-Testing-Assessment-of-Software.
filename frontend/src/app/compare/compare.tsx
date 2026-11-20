"use client";

import type { Finding, Scan } from "@veritas/shared";
import { ArrowLeft, ArrowRight, Minus, TrendingDown, TrendingUp } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ApiErrorAlert, LoadingBlock } from "@/components/api-state";
import { SeverityBadge } from "@/components/findings/severity-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCompare, useScan } from "@/hooks/queries";
import { dimensionLabel, formatDateTime, formatLocation } from "@/lib/format";
import { cn } from "@/lib/utils";

export function Compare() {
  const params = useSearchParams();
  const baseId = params.get("base");
  const headId = params.get("head");
  const comparison = useCompare(headId, baseId);
  const base = useScan(baseId ?? "");
  const head = useScan(headId ?? "");

  const back = (
    <Link
      href="/history"
      className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="size-4" aria-hidden />
      ประวัติ
    </Link>
  );
  if (!baseId || !headId) {
    return (
      <div className="space-y-4">
        {back}
        <p>เลือก 2 การสแกนจากหน้าประวัติเพื่อเทียบ</p>
      </div>
    );
  }
  const error = comparison.error ?? base.error ?? head.error;
  if (error) {
    return (
      <div className="space-y-4">
        {back}
        <ApiErrorAlert error={error} />
      </div>
    );
  }
  if (!comparison.data || !base.data || !head.data) return <LoadingBlock rows={6} />;
  const c = comparison.data;

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        {back}
        <p className="slash-label">Comparison</p>
        <h1 className="font-display text-4xl leading-tight font-black tracking-tight sm:text-5xl">
          เทียบการสแกน
        </h1>
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <Link href={`/scans/${base.data.id}`} className="hover:underline">
            {formatDateTime(base.data.startedAt)}
          </Link>
          <ArrowRight className="size-4" aria-label="ไปยัง" />
          <Link href={`/scans/${head.data.id}`} className="hover:underline">
            {formatDateTime(head.data.startedAt)}
          </Link>
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="คะแนนรวม" delta={c.scoreDelta} from={base.data.score} to={head.data.score} />
        <Card>
          <CardContent className="space-y-1">
            <p className="text-sm text-muted-foreground">ปัญหาใหม่</p>
            <p
              className={cn(
                "text-3xl font-semibold tabular-nums",
                c.introduced.length > 0 && "text-sev-high",
              )}
            >
              {c.introduced.length}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-1">
            <p className="text-sm text-muted-foreground">แก้แล้ว</p>
            <p
              className={cn(
                "text-3xl font-semibold tabular-nums",
                c.resolved.length > 0 && "text-good",
              )}
            >
              {c.resolved.length}
            </p>
            <p className="text-xs text-muted-foreground">ยังอยู่ {c.persistingCount} รายการ</p>
          </CardContent>
        </Card>
      </div>

      <DimensionDeltas base={base.data} head={head.data} />
      <FindingList title="ปัญหาใหม่" empty="ไม่มีปัญหาใหม่" findings={c.introduced} />
      <FindingList title="ปัญหาที่แก้แล้ว" empty="ไม่มีปัญหาที่ถูกแก้" findings={c.resolved} />
    </div>
  );
}

function Delta({ value, digits = 1 }: { value: number | null; digits?: number }) {
  if (value === null) return <span className="text-muted-foreground">—</span>;
  const rounded = Number(value.toFixed(digits));
  if (rounded === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-muted-foreground">
        <Minus className="size-4" aria-hidden />0
      </span>
    );
  }
  const up = rounded > 0;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 font-semibold tabular-nums",
        up ? "text-good" : "text-sev-high",
      )}
    >
      {up ? (
        <TrendingUp className="size-4" aria-hidden />
      ) : (
        <TrendingDown className="size-4" aria-hidden />
      )}
      {up ? "+" : ""}
      {rounded.toFixed(digits)}
    </span>
  );
}

function Stat({
  label,
  delta,
  from,
  to,
}: {
  label: string;
  delta: number | null;
  from: number | null;
  to: number | null;
}) {
  return (
    <Card>
      <CardContent className="space-y-1">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-3xl">
          <Delta value={delta} />
        </p>
        <p className="text-xs text-muted-foreground tabular-nums">
          {from === null ? "—" : from.toFixed(1)} → {to === null ? "—" : to.toFixed(1)}
        </p>
      </CardContent>
    </Card>
  );
}

function DimensionDeltas({ base, head }: { base: Scan; head: Scan }) {
  const dims = head.dimensions.filter((d) =>
    base.dimensions.some((b) => b.dimension === d.dimension),
  );
  if (dims.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>คะแนนรายมิติ</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
          {dims.map((d) => {
            const before = base.dimensions.find((b) => b.dimension === d.dimension)?.score ?? null;
            const after = d.score;
            return (
              <li key={d.dimension} className="flex items-center gap-3 text-sm">
                <span className="flex-1">{dimensionLabel(d.dimension)}</span>
                <span className="text-muted-foreground tabular-nums">
                  {before === null ? "—" : Math.round(before)} →{" "}
                  {after === null ? "—" : Math.round(after)}
                </span>
                <span className="w-16 text-right">
                  <Delta
                    value={before === null || after === null ? null : after - before}
                    digits={0}
                  />
                </span>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

function FindingList({
  title,
  empty,
  findings,
}: {
  title: string;
  empty: string;
  findings: Finding[];
}) {
  return (
    <section className="space-y-3" aria-label={title}>
      <h2 className="text-lg font-semibold">
        {title} ({findings.length})
      </h2>
      {findings.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="divide-y rounded-xl border">
          {findings.map((f) => (
            <li key={f.id}>
              <Link
                href={`/findings/${f.id}`}
                className="flex items-start gap-3 px-4 py-3 hover:bg-muted/50"
              >
                <SeverityBadge severity={f.severity} className="mt-0.5" />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{f.message}</span>
                  <span className="block truncate font-mono text-xs text-muted-foreground">
                    {formatLocation(f)} · {f.ruleId}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
