import type { Scan } from "@veritas/shared";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import Link from "next/link";
import { SeverityCountsRow } from "@/components/findings/severity-badge";
import { Badge } from "@/components/ui/badge";
import { formatDateTime, formatDuration, gradeTone, scanDuration } from "@/lib/format";
import { cn } from "@/lib/utils";

export function RecentScans({ scans }: { scans: Scan[] }) {
  if (scans.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">ยังไม่มีการสแกน กดปุ่ม "เริ่มสแกน" เพื่อเริ่มครั้งแรก</p>
    );
  }
  return (
    <ul className="divide-y rounded-xl border">
      {scans.map((scan) => {
        const duration = scanDuration(scan);
        return (
          <li key={scan.id}>
            <Link
              href={`/scans/${scan.id}`}
              className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 hover:bg-muted/50 focus-visible:bg-muted/50"
            >
              <span className="w-12 text-xl font-semibold tabular-nums">
                {scan.score === null ? "—" : Math.round(scan.score)}
              </span>
              <span className={cn("w-6 font-semibold", scan.grade && gradeTone(scan.grade))}>
                {scan.grade ?? ""}
              </span>
              <span className="min-w-40 flex-1">
                <span className="block text-sm">
                  <span className="font-medium">{projectName(scan.root)}</span>
                  <span className="text-muted-foreground"> · {formatDateTime(scan.startedAt)}</span>
                </span>
                <span className="block text-xs text-muted-foreground">
                  {scan.status === "running"
                    ? "กำลังสแกน"
                    : scan.status === "failed"
                      ? `ล้มเหลว${duration !== null ? ` · ${formatDuration(duration)}` : ""}`
                      : duration !== null
                        ? formatDuration(duration)
                        : ""}
                </span>
              </span>
              {scan.status === "completed" && (
                <SeverityCountsRow counts={scan.counts} className="text-xs" />
              )}
              <ScanStatusBadge scan={scan} />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function ScanStatusBadge({ scan }: { scan: Scan }) {
  if (scan.status === "running" || scan.status === "queued") {
    return (
      <Badge variant="secondary">
        <Loader2 className="animate-spin" aria-hidden />
        กำลังสแกน
      </Badge>
    );
  }
  if (scan.status === "failed") return <Badge variant="destructive">ล้มเหลว</Badge>;
  return scan.gate?.passed ? (
    <Badge variant="outline" className="text-good">
      <CheckCircle2 aria-hidden />
      ผ่านเกณฑ์
    </Badge>
  ) : (
    <Badge variant="outline" className="text-sev-high">
      <XCircle aria-hidden />
      ไม่ผ่านเกณฑ์
    </Badge>
  );
}

/** Last folder of the scanned path: the project name, for uploads and code/ alike. */
export function projectName(root: string): string {
  return root.split(/[\\/]/).filter(Boolean).at(-1) ?? root;
}
