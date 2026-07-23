/**
 * Feature flags for the 0719 + co. digital wedding home.
 *
 * Rules (packet 01):
 * - playlists, marathon, anniversaryCapsule, and memoryNotes stay false until
 *   real content and links are supplied. Do not flip them here.
 * - momentSearch graduated to every environment in the 2026-07-23 overhaul:
 *   its 1,721-image embedding backfill and protected search path are complete.
 */
export interface FeatureFlags {
  /** Weekend playlists module. Off until real playlist links exist. */
  playlists: boolean;
  /** Marathon story module. Off until real marathon details exist. */
  marathon: boolean;
  /** Natural-language Moment Search (local CLIP embeddings, scenes only). */
  momentSearch: boolean;
  /** Anniversary time-capsule module. Future flag. */
  anniversaryCapsule: boolean;
  /** Approved guest memory notes. Future flag. */
  memoryNotes: boolean;
}

export type FeatureFlagName = keyof FeatureFlags;

/**
 * Resolve the flag set for a given environment. Pure so tests can pin every
 * environment without mutating process.env.
 */
export function resolveFeatureFlags(
  env: string | undefined = process.env.NODE_ENV,
): FeatureFlags {
  void env;
  return {
    playlists: false,
    marathon: false,
    momentSearch: true,
    anniversaryCapsule: false,
    memoryNotes: false,
  };
}

/** Ambient snapshot for the current runtime environment. */
export const featureFlags: FeatureFlags = resolveFeatureFlags();
