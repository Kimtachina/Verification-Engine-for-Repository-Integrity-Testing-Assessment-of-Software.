"use client";

import { DIMENSION_META } from "@veritas/shared";
import { ArrowLeft, ExternalLink, Lightbulb } from "lucide-react";
import Link from "next/link";
import { ApiErrorAlert, LoadingBlock } from "@/components/api-state";
import { CodeSnippet } from "@/components/findings/code-snippet";
import { SeverityBadge } from "@/components/findings/severity-badge";
import { PageHero } from "@/components/page-hero";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useFinding } from "@/hooks/queries";
import { findingsHref } from "@/lib/finding-filters";
import { dimensionLabel, formatLocation, scanIdOfFinding } from "@/lib/format";

export function FindingDetail({ findingId }: { findingId: string }) {
  const { data: f, error } = useFinding(findingId);
  const scanId = scanIdOfFinding(findingId);

  const back = scanId && (
    <Link
      href={`/scans/${scanId}`}
      className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="size-4" aria-hidden />
      กลับไปผลการสแกน
    </Link>
  );

  if (error) {
    return (
      <div className="space-y-4">
        {back}
        <ApiErrorAlert error={error} />
      </div>
    );
  }
  if (!f) return <LoadingBlock rows={6} />;

  return (
    <article className="space-y-6">
      <PageHero seed={47} label="Finding" title={f.message} back={back} compact>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <SeverityBadge severity={f.severity} />
          <span className="text-muted-foreground">{dimensionLabel(f.dimension)}</span>
          <span className="text-muted-foreground" aria-hidden>
            ·
          </span>
          <span className="font-mono text-xs text-muted-foreground">{f.ruleId}</span>
        </div>
        <p className="font-mono text-sm break-all">
          {scanId && f.file !== "." ? (
            <Link href={findingsHref(scanId, { file: f.file })} className="hover:underline">
              {formatLocation(f)}
            </Link>
          ) : (
            formatLocation(f)
          )}
        </p>
      </PageHero>

      {f.snippet !== undefined && <CodeSnippet code={f.snippet} startLine={f.startLine} />}

      {f.suggestion && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Lightbulb className="size-4" aria-hidden />
              วิธีแก้
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm leading-relaxed">{f.suggestion}</CardContent>
        </Card>
      )}

      <dl className="grid grid-cols-1 gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">ตรวจพบโดย</dt>
          <dd className="font-mono">{f.source}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">มิติ</dt>
          <dd>
            {dimensionLabel(f.dimension)}{" "}
            <span className="text-muted-foreground">
              — {DIMENSION_META[f.dimension].description}
            </span>
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-muted-foreground">Fingerprint (ใช้ติดตามปัญหาเดิมข้ามการสแกน)</dt>
          <dd className="font-mono text-xs break-all">{f.fingerprint}</dd>
        </div>
      </dl>

      {f.helpUrl && (
        <a
          href={f.helpUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-sm font-medium hover:underline"
        >
          อ่านเพิ่มเติมเกี่ยวกับกฎนี้
          <ExternalLink className="size-4" aria-hidden />
        </a>
      )}
    </article>
  );
}
