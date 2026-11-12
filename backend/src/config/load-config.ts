import { existsSync, statSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { type Config, type ConfigInput, configSchema, DEFAULT_IGNORE } from "@veritas/shared";
import { z } from "zod";

export const CONFIG_FILENAME = "veritas.config.ts";

export interface ResolvedConfig extends Config {
  /** Absolute path of the directory to scan. */
  rootDir: string;
  /** DEFAULT_IGNORE followed by the user's patterns. */
  ignorePatterns: string[];
  /** Absolute path of the config file used, or null when running on defaults. */
  configPath: string | null;
}

export class ConfigError extends Error {
  override name = "ConfigError";
}

/**
 * Validates raw config and resolves paths against `baseDir`.
 * Kept separate from file loading so it can be tested without touching disk imports.
 */
export function resolveConfig(
  input: unknown,
  baseDir: string,
  configPath: string | null = null,
): ResolvedConfig {
  const parsed = configSchema.safeParse(input ?? {});
  if (!parsed.success) {
    const where = configPath ?? "config";
    throw new ConfigError(`Invalid ${where}:\n${z.prettifyError(parsed.error)}`);
  }
  const config = parsed.data;
  const rootDir = isAbsolute(config.root) ? config.root : resolve(baseDir, config.root);

  if (!existsSync(rootDir)) {
    throw new ConfigError(`Scan root does not exist: ${rootDir}`);
  }
  if (!statSync(rootDir).isDirectory()) {
    throw new ConfigError(`Scan root is not a directory: ${rootDir}`);
  }

  return {
    ...config,
    rootDir,
    ignorePatterns: [...DEFAULT_IGNORE, ...config.ignore],
    configPath,
  };
}

/**
 * Loads `veritas.config.ts` from `cwd` if present, otherwise uses defaults.
 * `overrides` (e.g. CLI flags) win over the file.
 */
export async function loadConfig(
  cwd: string = process.cwd(),
  overrides: ConfigInput = {},
): Promise<ResolvedConfig> {
  const configPath = resolve(cwd, CONFIG_FILENAME);
  let fileConfig: unknown = {};

  if (existsSync(configPath)) {
    try {
      const mod: { default?: unknown } = await import(pathToFileURL(configPath).href);
      fileConfig = mod.default ?? {};
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new ConfigError(`Could not load ${configPath}: ${reason}`);
    }
  }

  const merged = mergeConfig(fileConfig, overrides);
  return resolveConfig(merged, dirname(configPath), existsSync(configPath) ? configPath : null);
}

/**
 * Shallow merge with one level of nesting for the object-valued sections: `overrides`
 * wins field by field inside thresholds, gate and weights; other fields are replaced whole.
 */
export function mergeConfig(base: unknown, overrides: ConfigInput): unknown {
  if (typeof base !== "object" || base === null) return base;
  const b = base as Record<string, unknown>;
  const nested = ["thresholds", "gate", "weights"] as const;
  const result: Record<string, unknown> = { ...b, ...overrides };
  for (const key of nested) {
    if (overrides[key] !== undefined) {
      result[key] = { ...(b[key] as object | undefined), ...overrides[key] };
    }
  }
  return result;
}
