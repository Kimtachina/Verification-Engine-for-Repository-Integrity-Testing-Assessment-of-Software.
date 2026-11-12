import {
  DIMENSIONS,
  type Dimension,
  SEVERITIES,
  type Settings,
  type SettingsOverrides,
  type Severity,
} from "@veritas/shared";

export const THRESHOLD_FIELDS = [
  { key: "maxCyclomatic", label: "Cyclomatic สูงสุดต่อฟังก์ชัน", step: 1 },
  { key: "maxCognitive", label: "Cognitive สูงสุดต่อฟังก์ชัน", step: 1 },
  { key: "maxNesting", label: "ความลึกการซ้อนสูงสุด", step: 1 },
  { key: "maxFunctionLines", label: "ความยาวฟังก์ชันสูงสุด (บรรทัด)", step: 1 },
  { key: "maxFileLines", label: "ความยาวไฟล์สูงสุด (บรรทัด)", step: 1 },
  { key: "maxFileSizeKb", label: "ขนาดไฟล์ข้อความสูงสุด (KiB)", step: 1 },
  { key: "minDuplicateLines", label: "โค้ดซ้ำขั้นต่ำที่รายงาน (บรรทัด)", step: 1 },
  { key: "maxDuplicatePercent", label: "โค้ดซ้ำรวมสูงสุด (%)", step: 0.5 },
  { key: "minTestRatio", label: "สัดส่วนไฟล์เทสต์ต่อไฟล์โค้ดขั้นต่ำ (0–1)", step: 0.05 },
  { key: "minDocCoverage", label: "สัดส่วนที่มีเอกสารขั้นต่ำ (0–1)", step: 0.05 },
] as const;

export type ThresholdKey = (typeof THRESHOLD_FIELDS)[number]["key"];

/**
 * Form state: every field is a string, "" meaning "not overridden, use veritas.config.ts".
 * Strings keep a half-typed "0." from being turned into 0 under the user's cursor.
 */
export interface SettingsFormState {
  failOn: Severity | "";
  minScore: string;
  thresholds: Record<ThresholdKey, string>;
  weights: Record<Dimension, string>;
  ignore: string;
  timeoutSeconds: string;
}

const str = (n: number | undefined) => (n === undefined ? "" : String(n));

export function toFormState(overrides: SettingsOverrides): SettingsFormState {
  return {
    failOn: overrides.gate?.failOn ?? "",
    minScore: str(overrides.gate?.minScore),
    thresholds: Object.fromEntries(
      THRESHOLD_FIELDS.map(({ key }) => [key, str(overrides.thresholds?.[key])]),
    ) as Record<ThresholdKey, string>,
    weights: Object.fromEntries(DIMENSIONS.map((d) => [d, str(overrides.weights?.[d])])) as Record<
      Dimension,
      string
    >,
    ignore: (overrides.ignore ?? []).join("\n"),
    timeoutSeconds:
      overrides.analyzerTimeoutMs === undefined ? "" : String(overrides.analyzerTimeoutMs / 1000),
  };
}

/** Only filled-in fields become overrides; the server validates the values. */
export function toOverrides(form: SettingsFormState): SettingsOverrides {
  const num = (v: string) => (v.trim() === "" ? undefined : Number(v));
  const overrides: SettingsOverrides = {};

  const gate: NonNullable<SettingsOverrides["gate"]> = {};
  if (form.failOn && (SEVERITIES as readonly string[]).includes(form.failOn))
    gate.failOn = form.failOn;
  const minScore = num(form.minScore);
  if (minScore !== undefined) gate.minScore = minScore;
  if (Object.keys(gate).length > 0) overrides.gate = gate;

  const thresholds: Record<string, number> = {};
  for (const { key } of THRESHOLD_FIELDS) {
    const value = num(form.thresholds[key]);
    if (value !== undefined) thresholds[key] = value;
  }
  if (Object.keys(thresholds).length > 0) overrides.thresholds = thresholds;

  const weights: Partial<Record<Dimension, number>> = {};
  for (const d of DIMENSIONS) {
    const value = num(form.weights[d]);
    if (value !== undefined) weights[d] = value;
  }
  if (Object.keys(weights).length > 0) overrides.weights = weights;

  const ignore = form.ignore
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (ignore.length > 0) overrides.ignore = ignore;

  const seconds = num(form.timeoutSeconds);
  if (seconds !== undefined) overrides.analyzerTimeoutMs = Math.round(seconds * 1000);
  return overrides;
}

/** The value a blank field falls back to, shown as its placeholder. */
export function effectivePlaceholder(settings: Settings, field: ThresholdKey): string {
  const value = settings.effective.thresholds[field];
  return value === undefined ? "" : String(value);
}
