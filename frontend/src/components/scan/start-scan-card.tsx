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
import { useStartScan } from "@/hooks/queries";
import { dimensionLabel } from "@/lib/format";

/**
 * Choose dimensions and start a scan. A dimension whose tools are all missing is still
 * selectable: the scan reports it as skipped with the install command, which is the
 * clearest way to explain it.
 */
export function StartScanCard({
  health,
  onStarted,
}: {
  health: Health;
  onStarted: (scanId: string) => void;
}) {
  const [selected, setSelected] = useState<Set<Dimension>>(() => new Set(DIMENSIONS));
  const start = useStartScan();
  const running = health.runningScanId !== null || start.isPending;
  const missing = new Set(health.tools.filter((t) => !t.available).map((t) => t.name));

  const toggle = (d: Dimension, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(d);
      else next.delete(d);
      return next;
    });

  const submit = () =>
    start.mutate(
      { dimensions: DIMENSIONS.filter((d) => selected.has(d)) },
      { onSuccess: (scan) => onStarted(scan.id) },
    );

  return (
    <Card>
      <CardHeader>
        <CardTitle>เริ่มสแกน</CardTitle>
        <CardDescription className="break-all">
          โฟลเดอร์ที่ตรวจ: <code className="font-mono">{health.root}</code>
        </CardDescription>
      </CardHeader>
      <CardContent>
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
                    disabled={running}
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
        {start.error && (
          <div className="mt-4">
            <ApiErrorAlert error={start.error} />
          </div>
        )}
      </CardContent>
      <CardFooter className="justify-between gap-3">
        <span className="text-xs text-muted-foreground">
          VERITAS อ่านโค้ดอย่างเดียว ไม่รันหรือติดตั้งอะไรในโฟลเดอร์นี้
        </span>
        <Button onClick={submit} disabled={running || selected.size === 0}>
          <Play aria-hidden />
          {running ? "กำลังสแกน…" : "เริ่มสแกน"}
        </Button>
      </CardFooter>
    </Card>
  );
}
