import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_IGNORE, DIMENSIONS } from "@veritas/shared";
import { ConfigError, loadConfig, resolveConfig } from "../../src/config/load-config";
import { enabledDimensions, resolveWeights } from "../../src/config/weights";

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "veritas-config-"));
  mkdirSync(join(dir, "code"));
  mkdirSync(join(dir, "other"));
  writeFileSync(join(dir, "a-file"), "");
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("resolveConfig", () => {
  test("defaults resolve root to <base>/code and prepend default ignores", () => {
    const config = resolveConfig({}, dir);
    expect(config.rootDir).toBe(join(dir, "code"));
    expect(config.ignorePatterns.slice(0, DEFAULT_IGNORE.length)).toEqual([...DEFAULT_IGNORE]);
    expect(config.configPath).toBeNull();
  });

  test("user ignores are appended after defaults", () => {
    const config = resolveConfig({ ignore: ["**/generated/**"] }, dir);
    expect(config.ignorePatterns.at(-1)).toBe("**/generated/**");
  });

  test("missing root throws ConfigError", () => {
    expect(() => resolveConfig({ root: "nope" }, dir)).toThrow(ConfigError);
  });

  test("root that is a file throws ConfigError", () => {
    expect(() => resolveConfig({ root: "a-file" }, dir)).toThrow(/not a directory/);
  });

  test("invalid values report the field", () => {
    expect(() => resolveConfig({ thresholds: { maxNesting: -2 } }, dir)).toThrow(/maxNesting/);
  });
});

describe("loadConfig", () => {
  test("runs on defaults when no config file exists", async () => {
    const config = await loadConfig(dir);
    expect(config.configPath).toBeNull();
    expect(config.rootDir).toBe(join(dir, "code"));
  });

  test("reads the config file and lets overrides win, merging nested sections", async () => {
    const withFile = mkdtempSync(join(tmpdir(), "veritas-config-file-"));
    mkdirSync(join(withFile, "code"));
    mkdirSync(join(withFile, "src"));
    writeFileSync(
      join(withFile, "veritas.config.ts"),
      `export default { root: "src", thresholds: { maxNesting: 3, maxFileLines: 300 } };`,
    );
    try {
      const config = await loadConfig(withFile, { thresholds: { maxNesting: 5 } });
      expect(config.configPath).toBe(join(withFile, "veritas.config.ts"));
      expect(config.rootDir).toBe(join(withFile, "src"));
      expect(config.thresholds.maxNesting).toBe(5);
      expect(config.thresholds.maxFileLines).toBe(300);
    } finally {
      rmSync(withFile, { recursive: true, force: true });
    }
  });

  test("a config file that throws becomes a ConfigError", async () => {
    const broken = mkdtempSync(join(tmpdir(), "veritas-config-broken-"));
    writeFileSync(join(broken, "veritas.config.ts"), `throw new Error("boom");`);
    try {
      await expect(loadConfig(broken)).rejects.toThrow(/Could not load.*boom/);
    } finally {
      rmSync(broken, { recursive: true, force: true });
    }
  });
});

describe("weights", () => {
  test("overrides replace defaults; others keep their default", () => {
    const weights = resolveWeights({ weights: { security: 9 } });
    expect(weights.security).toBe(9);
    expect(weights.integrity).toBe(1);
    expect(Object.keys(weights)).toHaveLength(DIMENSIONS.length);
  });

  test("enabledDimensions falls back to all", () => {
    expect(enabledDimensions({})).toEqual(DIMENSIONS);
    expect(enabledDimensions({ dimensions: ["secrets"] })).toEqual(["secrets"]);
  });
});
