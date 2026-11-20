"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ApiErrorAlert, LoadingBlock } from "@/components/api-state";
import { SeverityCountsRow } from "@/components/findings/severity-badge";
import { DimensionGrid } from "@/components/scan/dimension-grid";
import { ScanStatusBadge } from "@/components/scan/recent-scans";
import { ReportDownloads } from "@/components/scan/report-downloads";
import { ScanProgressCard } from "@/components/scan/scan-progress-card";
import { ScoreRing } from "@/components/scan/score-ring";
import { Card, CardContent } from "@/components/ui/card";
import { useScan } from "@/hooks/queries";
import { findingsHref } from "@/lib/finding-filters";
import { formatDateTime, formatDuration, formatNumber, scanDuration } from "@/lib/format";
import { cn } from "@/lib/utils";

export function ScanHeader({ scanId }: { scanId: string }) {
  const { data: scan, error } = useScan(scanId);
  const pathname = usePathname();

  if (error) return <ApiErrorAlert error={error} />;
  if (!scan) return <LoadingBlock rows={4} />;
  const duration = scanDuration(scan);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <Link
            href="/"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" aria-hidden />
            ภาพรวม
          </Link>
          <p className="slash-label">Scan Report</p>
          <h1 className="font-display text-4xl leading-tight font-black tracking-tight sm:text-5xl">
            ผลการสแกน
          </h1>
          <p className="text-sm text-muted-foreground">
            {formatDateTime(scan.startedAt)}
            {duration !== null && ` · ใช้เวลา ${formatDuration(duration)}`}
          </p>
          <p className="break-all font-mono text-xs text-muted-foreground">{scan.root}</p>
        </div>
        {scan.status === "completed" && <ReportDownloads scanId={scan.id} />}
      </div>

      {scan.status === "running" || scan.status === "queued" ? (
        <ScanProgressCard scanId={scan.id} />
      ) : (
        <>
          <Card>
            <CardContent className="flex flex-wrap items-center gap-6">
              <ScoreRing score={scan.score} grade={scan.grade} />
              <div className="min-w-60 flex-1 space-y-2">
                <ScanStatusBadge scan={scan} />
                {scan.error && <p className="text-sm text-sev-high">{scan.error}</p>}
                {scan.gate && !scan.gate.passed && (
                  <p className="text-sm text-sev-high">{scan.gate.reasons.join(" · ")}</p>
                )}
                <SeverityCountsRow counts={scan.counts} />
                {scan.stats && (
                  <p className="text-sm text-muted-foreground">
                    {formatNumber(scan.stats.files)} ไฟล์ · {formatNumber(scan.stats.lines)} บรรทัด
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
          {scan.dimensions.length > 0 && (
            <DimensionGrid scan={scan} hrefFor={(d) => findingsHref(scan.id, { dimension: [d] })} />
          )}
        </>
      )}

      {scan.status === "completed" && (
        <nav className="flex gap-1 border-b" aria-label="มุมมองผลการสแกน">
          {[
            { href: `/scans/${scan.id}`, label: "ปัญหาที่พบ" },
            { href: `/scans/${scan.id}/files`, label: "รายไฟล์" },
          ].map((tab) => {
            const active = pathname === tab.href;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "-mb-px border-b-2 px-3 py-2 text-sm font-medium",
                  active
                    ? "border-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
      )}
    </div>
  );
}
