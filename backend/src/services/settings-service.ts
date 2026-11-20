import {
  type ConfigInput,
  type Settings,
  type SettingsOverrides,
  settingsOverridesSchema,
} from "@veritas/shared";
import { eq } from "drizzle-orm";
import { loadConfig, mergeConfig, type ResolvedConfig } from "../config/load-config";
import { resolveWeights } from "../config/weights";
import type { Db } from "../db/client";
import { settings } from "../db/schema";

const OVERRIDES_KEY = "overrides";

/**
 * Settings saved from the dashboard, layered over veritas.config.ts:
 * file < saved overrides < options sent with a scan request.
 *
 * Only dashboard/API scans use them; the CLI reads veritas.config.ts alone, so CI runs
 * stay reproducible from the repository.
 */
export class SettingsService {
  constructor(
    private readonly db: Db,
    private readonly configDir: string,
    /** Applied under the saved overrides. Tests use it to point the root at a fixture. */
    private readonly base: ConfigInput = {},
  ) {}

  async overrides(): Promise<SettingsOverrides> {
    const [row] = await this.db
      .select()
      .from(settings)
      .where(eq(settings.key, OVERRIDES_KEY))
      .limit(1);
    // A row written by an older version that no longer validates is ignored, not fatal.
    const parsed = settingsOverridesSchema.safeParse(row?.value ?? {});
    return parsed.success ? parsed.data : {};
  }

  /** The config for a scan: file, then saved overrides, then the request's own options. */
  loadConfig = async (request: ConfigInput = {}): Promise<ResolvedConfig> =>
    this.resolve(await this.overrides(), request);

  async describe(saved?: SettingsOverrides): Promise<Settings> {
    const overrides = saved ?? (await this.overrides());
    const config = await this.resolve(overrides);
    return {
      overrides,
      effective: {
        root: config.rootDir,
        ignore: config.ignore,
        thresholds: config.thresholds,
        gate: config.gate,
        weights: resolveWeights(config),
        analyzerTimeoutMs: config.analyzerTimeoutMs,
      },
      configPath: config.configPath,
    };
  }

  /** Validates the overrides against the full config first; nothing is saved if they are invalid. */
  async update(overrides: SettingsOverrides): Promise<Settings> {
    const described = await this.describe(overrides);
    const row = { key: OVERRIDES_KEY, value: overrides, updatedAt: new Date().toISOString() };
    await this.db
      .insert(settings)
      .values(row)
      .onConflictDoUpdate({
        target: settings.key,
        set: { value: row.value, updatedAt: row.updatedAt },
      });
    return described;
  }

  private resolve(
    overrides: SettingsOverrides,
    request: ConfigInput = {},
  ): Promise<ResolvedConfig> {
    const layered = mergeConfig(mergeConfig(this.base, overrides), request) as ConfigInput;
    return loadConfig(this.configDir, layered);
  }
}
