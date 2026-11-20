"use client";

import { FileCode2 } from "lucide-react";
import Link from "next/link";
import { ApiErrorAlert, LoadingBlock } from "@/components/api-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useFiles } from "@/hooks/queries";
import { findingsHref } from "@/lib/finding-filters";
import { SeverityCountsRow } from "./severity-badge";

/** Files ranked by how much their findings weigh; each row opens that file's findings. */
export function FileTable({ scanId }: { scanId: string }) {
  const { data, error, isLoading } = useFiles(scanId);
  if (error) return <ApiErrorAlert error={error} />;
  if (isLoading || !data) return <LoadingBlock rows={6} />;
  if (data.length === 0) {
    return (
      <p className="rounded-xl border p-8 text-center text-sm text-muted-foreground">
        ไม่มีไฟล์ที่พบปัญหา
      </p>
    );
  }
  return (
    <div className="rounded-xl border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[55%]">ไฟล์</TableHead>
            <TableHead>ปัญหา</TableHead>
            <TableHead className="w-20 text-right">รวม</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((f) => (
            <TableRow key={f.file} className="relative">
              <TableCell className="max-w-0 whitespace-normal">
                <Link
                  href={findingsHref(scanId, { file: f.file })}
                  className="flex items-center gap-2 font-mono text-sm after:absolute after:inset-0 hover:underline"
                >
                  <FileCode2 className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="truncate">{f.file === "." ? "ทั้งโปรเจกต์" : f.file}</span>
                </Link>
              </TableCell>
              <TableCell>
                <SeverityCountsRow counts={f} includeInfo className="text-xs" />
              </TableCell>
              <TableCell className="text-right tabular-nums">{f.total}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
