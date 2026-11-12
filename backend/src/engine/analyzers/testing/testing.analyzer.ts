import {
  familyOf,
  isProgramSource,
  isTestFile,
  type LanguageFamily,
  moduleName,
  testedModuleName,
} from "../../discovery/classify";
import { type SourceFile, splitLines } from "../../discovery/source-file";
import { type Analyzer, PROJECT_FILE, type RawFinding } from "../analyzer";
import { readCoverage } from "./coverage-report";

const SOURCE = "veritas";
/** Files shorter than this are not worth a "no test" note (barrels, constants, __init__.py). */
const MIN_LINES_FOR_MODULE_TEST = 20;
const COVERAGE_MEDIUM_BELOW = 50;
const COVERAGE_LOW_BELOW = 80;

const FAMILY_LABEL: Record<LanguageFamily, string> = {
  js: "TypeScript/JavaScript",
  python: "Python",
};

interface Pattern {
  regex: RegExp;
  ruleId: string;
  severity: RawFinding["severity"];
  message: string;
  suggestion: string;
}

const ASSERTION: Record<LanguageFamily, RegExp> = {
  js: /\b(?:expect|assert)\s*[.(]|\.should\b|\bt\.(?:is|not|deepEqual|true|false|throws|snapshot)\s*\(/,
  python: /\bassert\b|\bself\.assert\w*\s*\(|\bpytest\.(?:raises|approx|warns)\b/,
};

const LINE_PATTERNS: Record<LanguageFamily, Pattern[]> = {
  js: [
    {
      regex: /\b(?:describe|it|test)\.only\s*\(|\bf(?:it|describe)\s*\(/,
      ruleId: "testing/focused-test",
      severity: "high",
      message: "Focused test (.only / fit / fdescribe) silently disables every other test.",
      suggestion: "Remove .only before committing.",
    },
    {
      regex: /\b(?:describe|it|test)\.(?:skip|todo)\s*\(|\bx(?:it|describe|test)\s*\(/,
      ruleId: "testing/skipped-test",
      severity: "low",
      message: "Skipped or placeholder test.",
      suggestion: "Fix and re-enable the test, or delete it.",
    },
  ],
  python: [
    {
      regex:
        /@pytest\.mark\.(?:skip|skipif|xfail)\b|@unittest\.(?:skip|skipIf|skipUnless|expectedFailure)\b/,
      ruleId: "testing/skipped-test",
      severity: "low",
      message: "Skipped or expected-failure test.",
      suggestion: "Fix and re-enable the test, or delete it.",
    },
  ],
};

/** Looks for a test-shaped body: a JS test call or a Python test function / class. */
const DEFINES_TESTS: Record<LanguageFamily, RegExp> = {
  js: /\b(?:it|test)\s*(?:\.\w+\s*)?\(/,
  python: /^\s*(?:async\s+)?def\s+test\w*\s*\(|^\s*class\s+Test\w*/m,
};

export const testingAnalyzer: Analyzer = {
  dimension: "testing",
  async run({ config, discovery }) {
    const sources = discovery.files.filter(isProgramSource);
    if (sources.length === 0) {
      return { status: "skipped", reason: "No TypeScript, JavaScript or Python source files" };
    }
    const tests = discovery.files.filter(
      (f): f is SourceFile & { content: string } =>
        f.content !== null && familyOf(f.language) !== null && isTestFile(f.path),
    );

    const findings: RawFinding[] = [];
    for (const family of ["js", "python"] as const) {
      const familySources = sources.filter((f) => familyOf(f.language) === family);
      if (familySources.length === 0) continue;
      const familyTests = tests.filter((f) => familyOf(f.language) === family);
      findings.push(
        ...checkTestPresence(family, familySources, familyTests, config.thresholds.minTestRatio),
      );
      for (const test of familyTests) findings.push(...checkTestFile(family, test));
    }
    findings.push(...(await checkCoverage(config.rootDir)));
    return { status: "completed", findings };
  },
};

function checkTestPresence(
  family: LanguageFamily,
  sources: SourceFile[],
  tests: SourceFile[],
  minRatio: number,
): RawFinding[] {
  const label = FAMILY_LABEL[family];
  if (tests.length === 0) {
    return [
      {
        severity: "high",
        ruleId: "testing/no-tests",
        message: `${sources.length} ${label} source file(s) and no test files.`,
        suggestion:
          family === "js"
            ? "Add tests next to the code as *.test.ts, or in a tests/ folder."
            : "Add pytest tests as tests/test_*.py.",
        file: PROJECT_FILE,
        source: SOURCE,
      },
    ];
  }

  const findings: RawFinding[] = [];
  // Real test-file ratio: conftest.py and helpers in tests/ count as tests already.
  const ratio = tests.length / sources.length;
  if (ratio < minRatio) {
    findings.push({
      severity: "medium",
      ruleId: "testing/low-test-ratio",
      message: `${label}: ${tests.length} test file(s) for ${sources.length} source file(s) (ratio ${ratio.toFixed(2)}, minimum ${minRatio}).`,
      suggestion: "Add tests for the modules with the most logic first.",
      file: PROJECT_FILE,
      source: SOURCE,
    });
  }

  const tested = new Set(tests.map((t) => testedModuleName(t.path)));
  for (const source of sources) {
    const name = moduleName(source.path);
    if (source.lines < MIN_LINES_FOR_MODULE_TEST || name === "index" || tested.has(name)) continue;
    findings.push({
      severity: "info",
      ruleId: "testing/no-matching-test",
      message: `No test file named after \`${name}\` was found.`,
      suggestion: "This may be fine if it is covered by other tests; check the coverage report.",
      file: source.path,
      source: SOURCE,
    });
  }
  return findings;
}

function checkTestFile(
  family: LanguageFamily,
  test: SourceFile & { content: string },
): RawFinding[] {
  const findings: RawFinding[] = [];
  const lines = splitLines(test.content);

  if (DEFINES_TESTS[family].test(test.content) && !ASSERTION[family].test(test.content)) {
    findings.push({
      severity: "medium",
      ruleId: "testing/no-assertions",
      message: "Test file defines tests but contains no assertions, so its tests cannot fail.",
      suggestion:
        family === "js" ? "Assert results with expect(...)." : "Assert results with assert.",
      file: test.path,
      source: SOURCE,
    });
  }

  lines.forEach((line, i) => {
    for (const pattern of LINE_PATTERNS[family]) {
      if (!pattern.regex.test(line)) continue;
      findings.push({
        severity: pattern.severity,
        ruleId: pattern.ruleId,
        message: pattern.message,
        suggestion: pattern.suggestion,
        file: test.path,
        startLine: i + 1,
        source: SOURCE,
      });
    }
  });
  return findings;
}

async function checkCoverage(rootDir: string): Promise<RawFinding[]> {
  const coverage = await readCoverage(rootDir);
  if (!coverage) {
    return [
      {
        severity: "info",
        ruleId: "testing/no-coverage-report",
        message: "No coverage report found, so line coverage is unknown.",
        suggestion:
          "Run tests with coverage (e.g. `bun test --coverage --coverage-reporter=lcov` or `pytest --cov --cov-report=xml`) before scanning.",
        file: PROJECT_FILE,
        source: SOURCE,
      },
    ];
  }
  if (coverage.linePercent >= COVERAGE_LOW_BELOW) return [];
  const date = coverage.modifiedAt.toISOString().slice(0, 10);
  return [
    {
      severity: coverage.linePercent < COVERAGE_MEDIUM_BELOW ? "medium" : "low",
      ruleId: "testing/low-coverage",
      message: `Line coverage is ${coverage.linePercent}% (report dated ${date}; it may be out of date).`,
      suggestion: `Aim for at least ${COVERAGE_LOW_BELOW}% on code with business logic.`,
      file: coverage.path,
      source: SOURCE,
    },
  ];
}
