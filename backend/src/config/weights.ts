import { type Config, DIMENSION_META, DIMENSIONS, type Dimension } from "@veritas/shared";

/** Default weights with user overrides applied. Not normalised; scoring does that. */
export function resolveWeights(config: Pick<Config, "weights">): Record<Dimension, number> {
  const weights = {} as Record<Dimension, number>;
  for (const d of DIMENSIONS) {
    weights[d] = config.weights[d] ?? DIMENSION_META[d].defaultWeight;
  }
  return weights;
}

/** Dimensions to run: the configured subset, or all of them. */
export function enabledDimensions(config: Pick<Config, "dimensions">): readonly Dimension[] {
  return config.dimensions ?? DIMENSIONS;
}
