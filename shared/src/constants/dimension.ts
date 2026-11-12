export const DIMENSIONS = [
  "integrity",
  "correctness",
  "lint",
  "complexity",
  "duplication",
  "security",
  "secrets",
  "dependencies",
  "testing",
  "maintainability",
] as const;

export type Dimension = (typeof DIMENSIONS)[number];

interface DimensionMeta {
  label: string;
  labelTh: string;
  description: string;
  /** Relative weight in the overall score. Normalised at scoring time, so only ratios matter. */
  defaultWeight: number;
  /** External tools this dimension relies on. Empty means fully built in. */
  tools: readonly string[];
}

export const DIMENSION_META: Record<Dimension, DimensionMeta> = {
  integrity: {
    label: "Integrity",
    labelTh: "ความสมบูรณ์ของไฟล์",
    description: "Broken encoding, leftover merge conflicts, oversized or stray binary files.",
    defaultWeight: 1,
    tools: [],
  },
  correctness: {
    label: "Correctness",
    labelTh: "ความถูกต้อง",
    description: "Code that fails to parse or type-check.",
    defaultWeight: 3,
    tools: ["tsc", "pyright"],
  },
  lint: {
    label: "Lint",
    labelTh: "รูปแบบและบั๊กที่พบบ่อย",
    description: "Known bug patterns and style rule violations.",
    defaultWeight: 1.5,
    tools: ["biome", "ruff"],
  },
  complexity: {
    label: "Complexity",
    labelTh: "ความซับซ้อน",
    description: "Cyclomatic complexity, nesting depth, and over-long functions or files.",
    defaultWeight: 1.5,
    tools: ["lizard"],
  },
  duplication: {
    label: "Duplication",
    labelTh: "โค้ดซ้ำ",
    description: "Copy-pasted blocks across files.",
    defaultWeight: 1,
    tools: ["jscpd"],
  },
  security: {
    label: "Security",
    labelTh: "ความปลอดภัย",
    description: "Injection, weak cryptography, and dangerous API usage.",
    defaultWeight: 3,
    tools: ["semgrep"],
  },
  secrets: {
    label: "Secrets",
    labelTh: "ข้อมูลลับหลุด",
    description: "API keys, tokens, and passwords committed in source.",
    defaultWeight: 3,
    tools: ["gitleaks"],
  },
  dependencies: {
    label: "Dependencies",
    labelTh: "แพ็กเกจที่ใช้",
    description: "Known vulnerabilities, unused packages, and licence issues.",
    defaultWeight: 2,
    tools: ["osv-scanner", "knip"],
  },
  testing: {
    label: "Testing",
    labelTh: "การทดสอบ",
    description: "Presence of tests, test-to-source ratio, and coverage reports.",
    defaultWeight: 1.5,
    tools: [],
  },
  maintainability: {
    label: "Maintainability",
    labelTh: "ความง่ายในการดูแล",
    description: "Documentation, naming, circular imports, dead code, and stale TODOs.",
    defaultWeight: 1,
    tools: ["madge", "knip"],
  },
};
