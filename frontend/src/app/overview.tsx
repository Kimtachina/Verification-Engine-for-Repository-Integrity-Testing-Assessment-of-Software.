"use client";

import Link from "next/link";
import { useState } from "react";
import { ApiErrorAlert, LoadingBlock } from "@/components/api-state";
import { SeverityCountsRow } from "@/components/findings/severity-badge";
import { IsoCity } from "@/components/iso-city";
import { DimensionGrid } from "@/components/scan/dimension-grid";
import { RecentScans, ScanStatusBadge } from "@/components/scan/recent-scans";
import { ScanProgressCard } from "@/components/scan/scan-progress-card";
import { ScoreRing } from "@/components/scan/score-ring";
import { StartScanCard } from "@/components/scan/start-scan-card";
import { ToolStatus } from "@/components/scan/tool-status";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useHealth, useScans } from "@/hooks/queries";
import { findingsHref } from "@/lib/finding-filters";
import { formatDateTime } from "@/lib/format";

export function Overview() {
  const health = useHealth();
  const scans = useScans();
  // The scan started from this page; a scan started elsewhere is picked up from /health.
  const [startedId, setStartedId] = useState<string | null>(null);
  const runningId = health.data?.runningScanId ?? null;
  const progressId = runningId ?? startedId;
  const latest = scans.data?.find((s) => s.status === "completed");

  if (health.error) return <ApiErrorAlert error={health.error} />;
  if (!health.data) return <LoadingBlock rows={5} />;

  return (
    <div className="space-y-8">
      <section className="relative overflow-hidden border border-foreground/35 bg-card/60 px-6 py-8 sm:px-8 sm:py-12">
        <IsoCity className="pointer-events-none absolute -right-16 -bottom-10 h-[150%] text-foreground/75 max-md:opacity-25" />
        <div className="relative max-w-md space-y-4">
          <p className="slash-label leading-relaxed">
            Verification Engine
            <br />
            for Repository Integrity
          </p>
          <h1 className="font-display text-6xl leading-[0.85] font-black tracking-tighter text-signal sm:text-7xl">
            VERITAS
          </h1>
          <p className="max-w-sm text-muted-foreground">
            สแกนโค้ด ดูคะแนนรวม และไล่แก้ปัญหาจากรุนแรงที่สุดก่อน ตรวจละเอียด 10 มิติ
          </p>
          <p className="font-display text-sm leading-tight font-bold tracking-wide">
            {"/// 10 DIMENSIONS"}
            <br />7 ANALYZERS
          </p>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-6">
          <StartScanCard health={health.data} onStarted={setStartedId} />
          {progressId && <ScanProgressCard key={progressId} scanId={progressId} />}
        </div>
        <Card>
          <CardHeader>
            <CardTitle>เครื่องมือตรวจ</CardTitle>
            <CardDescription>มิติที่ขาดเครื่องมือจะถูกข้ามพร้อมแจ้งเหตุผล ไม่นับเป็นคะแนนเต็ม</CardDescription>
          </CardHeader>
          <CardContent>
            <ToolStatus tools={health.data.tools} />
          </CardContent>
        </Card>
      </div>

      {latest && (
        <section className="space-y-4" aria-labelledby="latest-heading">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 id="latest-heading" className="slash-label">
                ผลสแกนล่าสุด
              </h2>
              <p className="text-sm text-muted-foreground">{formatDateTime(latest.startedAt)}</p>
            </div>
            <Button asChild variant="outline">
              <Link href={`/scans/${latest.id}`}>ดูรายละเอียด</Link>
            </Button>
          </div>
          <Card>
            <CardContent className="flex flex-wrap items-center gap-6">
              <ScoreRing score={latest.score} grade={latest.grade} />
              <div className="space-y-2">
                <ScanStatusBadge scan={latest} />
                <SeverityCountsRow counts={latest.counts} />
                {latest.gate && !latest.gate.passed && (
                  <p className="text-sm text-sev-high">{latest.gate.reasons.join(" · ")}</p>
                )}
              </div>
            </CardContent>
          </Card>
          <DimensionGrid
            scan={latest}
            hrefFor={(d) => findingsHref(latest.id, { dimension: [d] })}
          />
        </section>
      )}

      <section className="space-y-3" aria-labelledby="history-heading">
        <h2 id="history-heading" className="slash-label">
          การสแกนล่าสุด
        </h2>
        {scans.error ? (
          <ApiErrorAlert error={scans.error} />
        ) : scans.data ? (
          <RecentScans scans={scans.data} />
        ) : (
          <LoadingBlock />
        )}
      </section>
    </div>
  );
}
