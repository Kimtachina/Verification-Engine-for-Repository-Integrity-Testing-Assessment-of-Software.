"use client";

import type { Scan } from "@veritas/shared";
import { GitCompareArrows } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ApiErrorAlert, LoadingBlock } from "@/components/api-state";
import { SeverityCountsRow } from "@/components/findings/severity-badge";
import { PageHero } from "@/components/page-hero";
import { ScanStatusBadge } from "@/components/scan/recent-scans";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useHistory } from "@/hooks/queries";
import { formatDateTime, gradeTone } from "@/lib/format";
import { trendPath, trendPoints } from "@/lib/trend";
import { cn } from "@/lib/utils";

export function History() {
  const { data, error } = useHistory();
  // Two completed scans, in the order they were ticked.
  const [picked, setPicked] = useState<string[]>([]);

  if (error) return <ApiErrorAlert error={error} />;
  if (!data) return <LoadingBlock rows={6} />;

  const byId = new Map(data.map((s) => [s.id, s]));
  const toggle = (id: string, on: boolean) =>
    setPicked((prev) =>
      on ? [...prev.filter((p) => p !== id), id].slice(-2) : prev.filter((p) => p !== id),
    );
  // Compare older (base) → newer (head) whatever order they were picked in.
  const [base, head] = picked
    .map((id) => byId.get(id))
    .filter((s): s is Scan => s !== undefined)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));

  return (
    <div className="space-y-8">
      <PageHero seed={19} label="Scan History" title="ประวัติการสแกน">
        <p className="text-muted-foreground">
          ดูแนวโน้มคะแนน และเลือก 2 การสแกนเพื่อเทียบว่าอะไรดีขึ้นหรือแย่ลง
        </p>
      </PageHero>

      <Card>
        <CardHeader>
          <CardTitle>แนวโน้มคะแนนรวม</CardTitle>
          <CardDescription>เฉพาะการสแกนที่เสร็จสมบูรณ์ เรียงจากเก่าไปใหม่</CardDescription>
        </CardHeader>
        <CardContent>
          <TrendChart scans={data} />
        </CardContent>
      </Card>

      <section className="space-y-3" aria-labelledby="scan-list">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="scan-list" className="slash-label">
            ทั้งหมด {data.length} ครั้ง
          </h2>
          {base && head ? (
            <Button asChild>
              <Link href={`/compare?base=${base.id}&head=${head.id}`}>
                <GitCompareArrows aria-hidden />
                เทียบ 2 การสแกนที่เลือก
              </Link>
            </Button>
          ) : (
            <span className="text-sm text-muted-foreground">เลือก 2 การสแกนที่เสร็จแล้วเพื่อเทียบ</span>
          )}
        </div>
        {data.length === 0 ? (
          <p className="rounded-xl border p-8 text-center text-sm text-muted-foreground">
            ยังไม่มีการสแกน
          </p>
        ) : (
          <div className="rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <span className="sr-only">เลือกเพื่อเทียบ</span>
                  </TableHead>
                  <TableHead>เวลา</TableHead>
                  <TableHead className="w-24 text-right">คะแนน</TableHead>
                  <TableHead className="hidden md:table-cell">ปัญหา</TableHead>
                  <TableHead className="w-36">สถานะ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((scan) => (
                  <TableRow key={scan.id}>
                    <TableCell>
                      <Checkbox
                        checked={picked.includes(scan.id)}
                        disabled={scan.status !== "completed"}
                        onCheckedChange={(v) => toggle(scan.id, v === true)}
                        aria-label={`เลือกการสแกนเมื่อ ${formatDateTime(scan.startedAt)} เพื่อเทียบ`}
                      />
                    </TableCell>
                    <TableCell>
                      <Link href={`/scans/${scan.id}`} className="hover:underline">
                        {formatDateTime(scan.startedAt)}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {scan.score === null ? "—" : Math.round(scan.score)}{" "}
                      <span className={cn("font-semibold", scan.grade && gradeTone(scan.grade))}>
                        {scan.grade ?? ""}
                      </span>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {scan.status === "completed" && (
                        <SeverityCountsRow counts={scan.counts} className="text-xs" />
                      )}
                    </TableCell>
                    <TableCell>
                      <ScanStatusBadge scan={scan} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}

const BOX = { width: 720, height: 220, padding: 24 };

function TrendChart({ scans }: { scans: Scan[] }) {
  const points = trendPoints(scans, BOX);
  if (points.length === 0) {
    return <p className="text-sm text-muted-foreground">ยังไม่มีการสแกนที่เสร็จสมบูรณ์</p>;
  }
  const first = points[0]?.scan.score ?? 0;
  const last = points.at(-1)?.scan.score ?? 0;
  const summary =
    points.length > 1
      ? `คะแนนจาก ${first.toFixed(1)} เป็น ${last.toFixed(1)} ใน ${points.length} การสแกน`
      : `คะแนน ${last.toFixed(1)} จากการสแกน 1 ครั้ง`;
  return (
    <figure className="space-y-2">
      <svg
        viewBox={`0 0 ${BOX.width} ${BOX.height}`}
        className="h-auto w-full"
        role="img"
        aria-label={summary}
      >
        {[0, 60, 80, 90, 100].map((score) => {
          const y = BOX.padding + ((100 - score) / 100) * (BOX.height - BOX.padding * 2);
          return (
            <g key={score}>
              <line
                x1={BOX.padding}
                x2={BOX.width - BOX.padding}
                y1={y}
                y2={y}
                className="stroke-border"
                strokeDasharray="3 4"
              />
              <text x={0} y={y + 4} className="fill-muted-foreground text-[10px]">
                {score}
              </text>
            </g>
          );
        })}
        {points.length > 1 && (
          <path d={trendPath(points)} fill="none" strokeWidth={2} className="stroke-signal" />
        )}
        {points.map((p) => (
          <Link key={p.scan.id} href={`/scans/${p.scan.id}`}>
            <circle
              cx={p.x}
              cy={p.y}
              r={5}
              className={cn("fill-current", p.scan.grade ? gradeTone(p.scan.grade) : "")}
            >
              <title>{`${formatDateTime(p.scan.startedAt)} · ${p.scan.score.toFixed(1)} (${p.scan.grade})`}</title>
            </circle>
          </Link>
        ))}
      </svg>
      <figcaption className="text-sm text-muted-foreground">{summary}</figcaption>
    </figure>
  );
}
