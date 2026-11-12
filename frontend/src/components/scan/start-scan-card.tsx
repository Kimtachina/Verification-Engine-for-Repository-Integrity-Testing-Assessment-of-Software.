"use client";

import { DIMENSION_META, DIMENSIONS, type Dimension, type Health } from "@veritas/shared";
import { Play } from "lucide-react";
import { useState } from "react";
import { ApiErrorAlert } from "@/components/api-state";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { useStartScan } from "@/hooks/queries";
import { api } from "@/lib/api-client";
import { dimensionLabel } from "@/lib/format";
import type { UploadSelection } from "@/lib/upload";
import { cn } from "@/lib/utils";
import { UploadPicker } from "./upload-picker";

type Source = "server" | "upload";

/**
 * Choose what to scan (the server's configured folder, or a folder uploaded from this
 * computer) and which dimensions, then start. A dimension whose tools are missing stays
 * selectable: the scan reports it as skipped with the install command.
 */
export function StartScanCard({
  health,
  onStarted,
}: {
  health: Health;
  onStarted: (scanId: string) => void;
}) {
  const [selected, setSelected] = useState<Set<Dimension>>(() => new Set(DIMENSIONS));
  const [source, setSource] = useState<Source>("upload");
  const [selection, setSelection] = useState<UploadSelection | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<unknown>(null);
  const start = useStartScan();

  const uploading = uploadProgress !== null;
  const busy = health.runningScanId !== null || start.isPending || uploading;
  const missing = new Set(health.tools.filter((t) => !t.available).map((t) => t.name));
  const uploadReady = selection !== null && selection.error === null;
  const canStart = !busy && selected.size > 0 && (source === "server" || uploadReady);

  const toggle = (d: Dimension, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(d);
      else next.delete(d);
      return next;
    });

  const submit = async () => {
    const dimensions = DIMENSIONS.filter((d) => selected.has(d));
    setUploadError(null);
    let uploadId: string | undefined;
    if (source === "upload" && selection) {
      setUploadProgress(0);
      try {
        uploadId = (await api.uploadFolder(selection.name, selection.files, setUploadProgress)).id;
      } catch (error) {
        setUploadError(error);
        return;
      } finally {
        setUploadProgress(null);
      }
    }
    start.mutate(
      { dimensions, ...(uploadId && { uploadId }) },
      { onSuccess: (scan) => onStarted(scan.id) },
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>เริ่มสแกน</CardTitle>
        <CardDescription>เลือกโค้ดที่ต้องการตรวจ แล้วเลือกมิติ</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <fieldset className="space-y-3">
          <legend className="mb-2 text-sm font-medium">โค้ดที่จะตรวจ</legend>
          {/* Native radios: arrow keys and screen readers work without extra code. */}
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                { value: "upload", label: "อัปโหลดโฟลเดอร์จากเครื่อง" },
                { value: "server", label: "โฟลเดอร์ code/ บนเซิร์ฟเวอร์" },
              ] as const
            ).map((option) => (
              <label
                key={option.value}
                className={cn(
                  "cursor-pointer rounded-lg border px-3 py-2 text-sm transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
                  source === option.value
                    ? "border-foreground bg-muted font-medium"
                    : "text-muted-foreground hover:bg-muted/50",
                  busy && "cursor-not-allowed opacity-60",
                )}
              >
                <input
                  type="radio"
                  name="scan-source"
                  value={option.value}
                  checked={source === option.value}
                  onChange={() => setSource(option.value)}
                  disabled={busy}
                  className="sr-only"
                />
                {option.label}
              </label>
            ))}
          </div>
          {source === "upload" ? (
            <UploadPicker selection={selection} onChange={setSelection} disabled={busy} />
          ) : (
            <p className="text-sm break-all text-muted-foreground">
              ตรวจโฟลเดอร์ <code className="font-mono">{health.root}</code>
            </p>
          )}
        </fieldset>

        <fieldset>
          <legend className="mb-3 text-sm font-medium">มิติที่ต้องการตรวจ</legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {DIMENSIONS.map((d) => {
              const needs = DIMENSION_META[d].tools.filter((t) => missing.has(t));
              return (
                <div key={d} className="flex items-start gap-2 text-sm">
                  <Checkbox
                    id={`dimension-${d}`}
                    checked={selected.has(d)}
                    onCheckedChange={(v) => toggle(d, v === true)}
                    disabled={busy}
                    className="mt-0.5"
                  />
                  <label htmlFor={`dimension-${d}`}>
                    {dimensionLabel(d)}
                    {needs.length > 0 && (
                      <span className="block text-xs text-muted-foreground">
                        ยังไม่ได้ติดตั้ง {needs.join(", ")}
                      </span>
                    )}
                  </label>
                </div>
              );
            })}
          </div>
        </fieldset>

        {uploading && (
          <div className="space-y-1" aria-live="polite">
            <p className="text-sm">กำลังอัปโหลด… {Math.round((uploadProgress ?? 0) * 100)}%</p>
            <Progress value={(uploadProgress ?? 0) * 100} aria-label="ความคืบหน้าการอัปโหลด" />
          </div>
        )}
        {(uploadError ?? start.error) && <ApiErrorAlert error={uploadError ?? start.error} />}
      </CardContent>
      <CardFooter className="justify-between gap-3">
        <span className="text-xs text-muted-foreground">
          VERITAS อ่านโค้ดอย่างเดียว ไม่รันหรือติดตั้งอะไรในโค้ดที่ตรวจ
        </span>
        <Button onClick={submit} disabled={!canStart}>
          <Play aria-hidden />
          {uploading
            ? "กำลังอัปโหลด…"
            : busy
              ? "กำลังสแกน…"
              : source === "upload"
                ? "อัปโหลดและสแกน"
                : "เริ่มสแกน"}
        </Button>
      </CardFooter>
    </Card>
  );
}
