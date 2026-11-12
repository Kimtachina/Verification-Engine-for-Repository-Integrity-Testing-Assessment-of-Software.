"use client";

import type { Dimension } from "@veritas/shared";
import { CheckCircle2, CircleSlash, Loader2, XCircle } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useScanEvents } from "@/hooks/use-scan-events";
import { dimensionLabel, formatDuration, formatNumber } from "@/lib/format";
import { type DimensionProgress, percentDone } from "@/lib/scan-progress";

/** Live progress of a running scan, driven by the SSE stream. */
export function ScanProgressCard({ scanId }: { scanId: string }) {
  const progress = useScanEvents(scanId);
  const finished = progress.phase === "finished" ? progress.scan : null;

  const status =
    progress.phase === "connecting"
      ? "กำลังเชื่อมต่อ…"
      : progress.phase === "discovering"
        ? "กำลังรวบรวมไฟล์…"
        : progress.phase === "analyzing"
          ? `กำลังวิเคราะห์ ${formatNumber(progress.files ?? 0)} ไฟล์ (${formatNumber(progress.lines ?? 0)} บรรทัด)`
          : finished?.status === "failed"
            ? "การสแกนล้มเหลว"
            : "สแกนเสร็จแล้ว";

  return (
    <Card aria-live="polite">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {!finished && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {status}
        </CardTitle>
        {finished?.error && (
          <CardDescription className="text-sev-high">{finished.error}</CardDescription>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <Progress value={percentDone(progress)} aria-label="ความคืบหน้าการสแกน" />
        <ul className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
          {(Object.entries(progress.dimensions) as [Dimension, DimensionProgress][]).map(
            ([dimension, p]) => (
              <li key={dimension} className="flex items-center gap-2 text-sm">
                <ProgressIcon progress={p} />
                <span className="flex-1">{dimensionLabel(dimension)}</span>
                {p.state === "done" && (
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {p.run.status === "completed" ? `${p.run.findingCount} ข้อ · ` : ""}
                    {formatDuration(p.run.durationMs)}
                  </span>
                )}
              </li>
            ),
          )}
        </ul>
        {finished && (
          <Button asChild>
            <Link href={`/scans/${finished.id}`}>ดูผลการสแกน</Link>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function ProgressIcon({ progress }: { progress: DimensionProgress }) {
  if (progress.state === "running") {
    return <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="กำลังตรวจ" />;
  }
  switch (progress.run.status) {
    case "completed":
      return <CheckCircle2 className="size-4 text-good" aria-label="เสร็จ" />;
    case "skipped":
      return <CircleSlash className="size-4 text-muted-foreground" aria-label="ข้าม" />;
    case "failed":
      return <XCircle className="size-4 text-sev-high" aria-label="ล้มเหลว" />;
  }
}
