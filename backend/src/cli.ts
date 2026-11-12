#!/usr/bin/env bun
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { ConfigInput } from "@veritas/shared";
import { ConfigError, loadConfig } from "./config/load-config";
import { runScan } from "./engine/pipeline";
import { buildReport } from "./reports/json-report";
import { renderTerminalReport } from "./reports/terminal-report";
import { VERITAS_VERSION } from "./version";

export const EXIT = { passed: 0, gateFailed: 1, usage: 2, internal: 3 } as const;

const HELP = `VERITAS ${VERITAS_VERSION} — code quality verification

Usage: veritas scan [options]

Options:
  --root <dir>          Directory to scan (default: "root" in veritas.config.ts, else ./code)
  --config-dir <dir>    Directory containing veritas.config.ts (default: current directory)
  --dimensions <list>   Comma-separated dimensions to run (default: all)
  --fail-on <severity>  Fail the gate on findings at or above: critical|high|medium|low|info
  --min-score <n>       Fail the gate when the overall score is below n (0-100)
  --json <file>         Write the full report as JSON
  --top <n>             Number of findings to print (default 20)
  --all                 Print every finding
  --no-color            Disable colours (also honoured: NO_COLOR)
  -h, --help            Show this help
  -v, --version         Show the version

Exit codes: 0 gate passed · 1 gate failed · 2 usage or config error · 3 internal error`;

/** Bad command line. Printed with the help text; exits with EXIT.usage. */
class UsageError extends Error {
  override name = "UsageError";
}

type Values = ReturnType<typeof parse>["values"];

export async function main(argv: string[]): Promise<number> {
  try {
    const { values, positionals } = parseOrThrow(argv);
    if (values.version) {
      console.log(VERITAS_VERSION);
      return EXIT.passed;
    }
    if (values.help) {
      console.log(HELP);
      return EXIT.passed;
    }
    if (positionals.length === 0) throw new UsageError("No command given.");
    if (positionals.join(" ") !== "scan") {
      throw new UsageError(`Unknown command: ${positionals.join(" ")}`);
    }
    return await scanCommand(values);
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(`${error.message}\n\n${HELP}`);
      return EXIT.usage;
    }
    if (error instanceof ConfigError) {
      console.error(error.message);
      return EXIT.usage;
    }
    console.error("VERITAS failed unexpectedly:", error);
    return EXIT.internal;
  }
}

async function scanCommand(values: Values): Promise<number> {
  const top = parseTop(values);
  const config = await loadConfig(resolve(values["config-dir"] ?? "."), configOverrides(values));
  const outcome = await runScan(config);

  const color = !values["no-color"] && !process.env.NO_COLOR && Boolean(process.stdout.isTTY);
  console.log(renderTerminalReport(outcome.scan, outcome.findings, { color, top }));

  if (values.json) {
    const path = resolve(values.json);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(buildReport(outcome), null, 2)}\n`);
    console.log(`\nJSON report written to ${path}`);
  }
  return outcome.scan.gate?.passed === false ? EXIT.gateFailed : EXIT.passed;
}

function parseTop(values: Values): number {
  if (values.all) return Number.POSITIVE_INFINITY;
  const top = Number(values.top ?? 20);
  if (!Number.isInteger(top) || top < 0) {
    throw new UsageError(`--top must be a whole number, got "${values.top}"`);
  }
  return top;
}

/**
 * CLI flags as config overrides. Values are passed through unchecked: the config
 * schema validates them and reports bad ones by field name.
 */
function configOverrides(values: Values): ConfigInput {
  const overrides: ConfigInput = {};
  // --root is relative to where the user typed the command, not to the config file.
  if (values.root) overrides.root = resolve(values.root);
  if (values.dimensions) {
    overrides.dimensions = values.dimensions
      .split(",")
      .map((d) => d.trim()) as ConfigInput["dimensions"];
  }
  const gate: NonNullable<ConfigInput["gate"]> = {};
  if (values["fail-on"]) gate.failOn = values["fail-on"] as NonNullable<typeof gate.failOn>;
  if (values["min-score"] !== undefined) gate.minScore = Number(values["min-score"]);
  if (Object.keys(gate).length > 0) overrides.gate = gate;
  return overrides;
}

function parseOrThrow(argv: string[]): ReturnType<typeof parse> {
  try {
    return parse(argv);
  } catch (error) {
    throw new UsageError((error as Error).message);
  }
}

function parse(argv: string[]) {
  return parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      root: { type: "string" },
      "config-dir": { type: "string" },
      dimensions: { type: "string" },
      "fail-on": { type: "string" },
      "min-score": { type: "string" },
      json: { type: "string" },
      top: { type: "string" },
      all: { type: "boolean" },
      "no-color": { type: "boolean" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
  });
}

if (import.meta.main) {
  process.exit(await main(Bun.argv.slice(2)));
}
