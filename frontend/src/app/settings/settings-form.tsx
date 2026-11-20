"use client";

import { DIMENSIONS, SEVERITIES, type Settings } from "@veritas/shared";
import { Check, RotateCcw, Save } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { ApiErrorAlert, LoadingBlock } from "@/components/api-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSaveSettings, useSettings } from "@/hooks/queries";
import { dimensionLabel, severityLabel } from "@/lib/format";
import {
  effectivePlaceholder,
  type SettingsFormState,
  THRESHOLD_FIELDS,
  toFormState,
  toOverrides,
} from "@/lib/settings-form";

const FILE_VALUE = "file";

export function SettingsForm() {
  const settings = useSettings();
  const save = useSaveSettings();
  const [form, setForm] = useState<SettingsFormState | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // Start from the saved overrides once they arrive.
  useEffect(() => {
    if (settings.data && form === null) setForm(toFormState(settings.data.overrides));
  }, [settings.data, form]);

  if (settings.error) return <ApiErrorAlert error={settings.error} />;
  if (!settings.data || !form) return <LoadingBlock rows={8} />;
  const s: Settings = settings.data;

  const set = (patch: Partial<SettingsFormState>) => {
    setSavedAt(null);
    setForm((prev) => (prev ? { ...prev, ...patch } : prev));
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate(toOverrides(form), {
      onSuccess: (saved) => {
        setForm(toFormState(saved.overrides));
        setSavedAt(Date.now());
      },
    });
  };
  const reset = () =>
    save.mutate(
      {},
      {
        onSuccess: () => {
          setForm(toFormState({}));
          setSavedAt(Date.now());
        },
      },
    );

  return (
    <form onSubmit={submit} className="space-y-6">
      <div>
        <p className="slash-label">Configuration</p>
        <h1 className="font-display text-4xl leading-tight font-black tracking-tight sm:text-5xl">
          ตั้งค่า
        </h1>
        <p className="text-muted-foreground">
          ใช้กับการสแกนที่เริ่มจากหน้าเว็บนี้ ซ้อนทับค่าใน{" "}
          <code className="font-mono">{s.configPath ? "veritas.config.ts" : "ค่าเริ่มต้น"}</code>{" "}
          ช่องที่เว้นว่างจะใช้ค่าจากไฟล์ (แสดงเป็นตัวจาง) คำสั่ง <code className="font-mono">bun run scan</code>{" "}
          ใช้เฉพาะค่าในไฟล์ เพื่อให้ผลใน CI เหมือนเดิมทุกครั้ง
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>เกณฑ์ผ่าน (Quality gate)</CardTitle>
          <CardDescription>ไม่ผ่านเกณฑ์เมื่อพบปัญหาระดับนี้ขึ้นไป หรือคะแนนรวมต่ำกว่าที่กำหนด</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="ไม่ผ่านเมื่อพบปัญหาระดับ" htmlFor="failOn">
            <Select
              value={form.failOn || FILE_VALUE}
              onValueChange={(v) =>
                set({ failOn: v === FILE_VALUE ? "" : (v as SettingsFormState["failOn"]) })
              }
            >
              <SelectTrigger id="failOn" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={FILE_VALUE}>
                  ตามไฟล์ ({severityLabel(s.effective.gate.failOn)})
                </SelectItem>
                {SEVERITIES.map((sev) => (
                  <SelectItem key={sev} value={sev}>
                    {severityLabel(sev)} ขึ้นไป
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="คะแนนรวมขั้นต่ำ (0 = ไม่ตรวจ)" htmlFor="minScore">
            <Input
              id="minScore"
              type="number"
              min={0}
              max={100}
              step={1}
              inputMode="decimal"
              value={form.minScore}
              placeholder={String(s.effective.gate.minScore)}
              onChange={(e) => set({ minScore: e.target.value })}
            />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>เกณฑ์ของแต่ละมิติ</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {THRESHOLD_FIELDS.map((field) => (
            <Field key={field.key} label={field.label} htmlFor={field.key}>
              <Input
                id={field.key}
                type="number"
                min={0}
                step={field.step}
                inputMode="decimal"
                value={form.thresholds[field.key]}
                placeholder={effectivePlaceholder(s, field.key)}
                onChange={(e) =>
                  set({ thresholds: { ...form.thresholds, [field.key]: e.target.value } })
                }
              />
            </Field>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>น้ำหนักในคะแนนรวม</CardTitle>
          <CardDescription>
            ใช้เฉพาะอัตราส่วน 0 = ไม่นับมิตินั้นในคะแนนรวม (ยังรายงานปัญหาตามปกติ)
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {DIMENSIONS.map((d) => (
            <Field key={d} label={dimensionLabel(d)} htmlFor={`weight-${d}`}>
              <Input
                id={`weight-${d}`}
                type="number"
                min={0}
                max={100}
                step={0.5}
                inputMode="decimal"
                value={form.weights[d]}
                placeholder={String(s.effective.weights[d])}
                onChange={(e) => set({ weights: { ...form.weights, [d]: e.target.value } })}
              />
            </Field>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>ไฟล์ที่ไม่ตรวจและเวลา</CardTitle>
          <CardDescription>
            รูปแบบ glob บรรทัดละ 1 รูปแบบ ถ้าใส่ จะใช้แทนรายการในไฟล์ config (node_modules, dist และโฟลเดอร์
            build ถูกข้ามเสมอ)
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-[2fr_1fr]">
          <Field label="ไม่ตรวจไฟล์เหล่านี้" htmlFor="ignore">
            <textarea
              id="ignore"
              rows={5}
              value={form.ignore}
              placeholder={s.effective.ignore.join("\n") || "เช่น generated/**\n**/*.snap"}
              onChange={(e) => set({ ignore: e.target.value })}
              className="w-full rounded-md border bg-transparent px-3 py-2 font-mono text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
          </Field>
          <Field label="เวลาสูงสุดต่อมิติ (วินาที)" htmlFor="timeout">
            <Input
              id="timeout"
              type="number"
              min={1}
              max={3600}
              step={1}
              inputMode="numeric"
              value={form.timeoutSeconds}
              placeholder={String(s.effective.analyzerTimeoutMs / 1000)}
              onChange={(e) => set({ timeoutSeconds: e.target.value })}
            />
          </Field>
        </CardContent>
      </Card>

      {save.error && <ApiErrorAlert error={save.error} />}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={save.isPending}>
          <Save aria-hidden />
          บันทึก
        </Button>
        <Button type="button" variant="outline" onClick={reset} disabled={save.isPending}>
          <RotateCcw aria-hidden />
          ใช้ค่าจากไฟล์ทั้งหมด
        </Button>
        {savedAt && (
          <span className="inline-flex items-center gap-1 text-sm text-good" role="status">
            <Check className="size-4" aria-hidden />
            บันทึกแล้ว มีผลกับการสแกนครั้งถัดไป
          </span>
        )}
      </div>
    </form>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
      </label>
      {children}
    </div>
  );
}
