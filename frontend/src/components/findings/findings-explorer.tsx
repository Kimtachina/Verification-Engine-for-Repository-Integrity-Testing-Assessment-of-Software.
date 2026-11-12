"use client";

import { DIMENSIONS, SEVERITIES, type Severity } from "@veritas/shared";
import { ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ApiErrorAlert, LoadingBlock } from "@/components/api-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useFindings } from "@/hooks/queries";
import {
  type FindingFilters,
  filtersFromParams,
  filtersToParams,
  filtersToQuery,
  PAGE_SIZE,
} from "@/lib/finding-filters";
import { dimensionLabel, formatLocation, formatNumber, severityLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import { SEVERITY_CLASSES, SeverityBadge } from "./severity-badge";

const ALL = "all";

/** Filterable, paginated findings of one scan. All state lives in the URL. */
export function FindingsExplorer({ scanId }: { scanId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const filters = filtersFromParams(new URLSearchParams(params.toString()));
  const { data, error, isLoading, isFetching } = useFindings(scanId, filtersToQuery(filters));

  const update = (change: Partial<FindingFilters>) => {
    // Any filter change starts again from page 1; only explicit paging keeps the page.
    const next = { ...filters, page: 1, ...change };
    const qs = filtersToParams(next).toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  // Search box: type freely, query after a short pause.
  const [text, setText] = useState(filters.q);
  useEffect(() => setText(filters.q), [filters.q]);
  useEffect(() => {
    if (text === filters.q) return;
    const timer = setTimeout(() => update({ q: text }), 300);
    return () => clearTimeout(timer);
  });

  const toggleSeverity = (s: Severity) =>
    update({
      severity: filters.severity.includes(s)
        ? filters.severity.filter((x) => x !== s)
        : [...filters.severity, s],
    });

  const hasFilters =
    filters.severity.length > 0 || filters.dimension.length > 0 || filters.file || filters.q;
  const total = data?.total ?? 0;
  const first = total === 0 ? 0 : (filters.page - 1) * PAGE_SIZE + 1;
  const last = Math.min(filters.page * PAGE_SIZE, total);

  return (
    <section className="space-y-4" aria-label="ปัญหาที่พบ">
      <div className="flex flex-wrap items-center gap-2">
        <fieldset className="flex flex-wrap gap-1.5">
          <legend className="sr-only">กรองตามความรุนแรง</legend>
          {SEVERITIES.map((s) => {
            const on = filters.severity.includes(s);
            return (
              <button
                key={s}
                type="button"
                aria-pressed={on}
                onClick={() => toggleSeverity(s)}
                className={cn(
                  "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
                  on
                    ? cn(SEVERITY_CLASSES[s].bg, SEVERITY_CLASSES[s].text, "border-current")
                    : "text-muted-foreground hover:bg-muted",
                )}
              >
                {severityLabel(s)}
              </button>
            );
          })}
        </fieldset>

        <Select
          value={filters.dimension[0] ?? ALL}
          onValueChange={(v) =>
            update({ dimension: v === ALL ? [] : [v as (typeof DIMENSIONS)[number]] })
          }
        >
          <SelectTrigger className="w-44" aria-label="กรองตามมิติ">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>ทุกมิติ</SelectItem>
            {DIMENSIONS.map((d) => (
              <SelectItem key={d} value={d}>
                {dimensionLabel(d)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filters.sort}
          onValueChange={(v) => update({ sort: v as FindingFilters["sort"] })}
        >
          <SelectTrigger className="w-40" aria-label="เรียงตาม">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="severity">เรียง: ความรุนแรง</SelectItem>
            <SelectItem value="file">เรียง: ไฟล์</SelectItem>
            <SelectItem value="dimension">เรียง: มิติ</SelectItem>
          </SelectContent>
        </Select>

        <div className="relative min-w-52 flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="ค้นหาข้อความ กฎ หรือไฟล์"
            aria-label="ค้นหาปัญหา"
            className="pl-8"
          />
        </div>
      </div>

      {(filters.file || hasFilters) && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {filters.file && (
            <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 font-mono text-xs">
              {filters.file === "." ? "ทั้งโปรเจกต์" : filters.file}
              <button type="button" onClick={() => update({ file: "" })} aria-label="ล้างตัวกรองไฟล์">
                <X className="size-3" />
              </button>
            </span>
          )}
          {hasFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => update({ severity: [], dimension: [], file: "", q: "" })}
            >
              ล้างตัวกรองทั้งหมด
            </Button>
          )}
        </div>
      )}

      {error ? (
        <ApiErrorAlert error={error} />
      ) : isLoading ? (
        <LoadingBlock rows={6} />
      ) : total === 0 ? (
        <p className="rounded-xl border p-8 text-center text-sm text-muted-foreground">
          {hasFilters ? "ไม่มีปัญหาที่ตรงกับตัวกรอง" : "ไม่พบปัญหาในการสแกนนี้"}
        </p>
      ) : (
        <div className={cn("rounded-xl border transition-opacity", isFetching && "opacity-70")}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-28">ความรุนแรง</TableHead>
                <TableHead>ปัญหา</TableHead>
                <TableHead className="hidden w-36 md:table-cell">มิติ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.items.map((f) => (
                <TableRow key={f.id} className="relative">
                  <TableCell className="align-top">
                    <SeverityBadge severity={f.severity} />
                  </TableCell>
                  <TableCell className="max-w-0 align-top whitespace-normal">
                    {/* The whole row is clickable through this link's stretched pseudo-element. */}
                    <Link
                      href={`/findings/${f.id}`}
                      className="block font-medium after:absolute after:inset-0 hover:underline focus-visible:underline"
                    >
                      {f.message}
                    </Link>
                    <span className="mt-1 block truncate font-mono text-xs text-muted-foreground">
                      {formatLocation(f)} · {f.ruleId}
                    </span>
                  </TableCell>
                  <TableCell className="hidden align-top text-sm text-muted-foreground md:table-cell">
                    {dimensionLabel(f.dimension)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {total > PAGE_SIZE && (
        <nav className="flex items-center justify-between text-sm" aria-label="แบ่งหน้า">
          <span className="text-muted-foreground tabular-nums">
            แสดง {formatNumber(first)}–{formatNumber(last)} จาก {formatNumber(total)}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={filters.page <= 1}
              onClick={() => update({ page: filters.page - 1 })}
            >
              <ChevronLeft aria-hidden />
              ก่อนหน้า
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={last >= total}
              onClick={() => update({ page: filters.page + 1 })}
            >
              ถัดไป
              <ChevronRight aria-hidden />
            </Button>
          </div>
        </nav>
      )}
    </section>
  );
}
