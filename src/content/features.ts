/**
 * Feature flags for the 0719 + co. digital wedding home.
 *
 * Rules (packet 01):
 * - playlists, marathon, anniversaryCapsule, and memoryNotes stay false until
 *   real content and links are supplied. Do not flip them here.
 * - momentSearch is true only in development until packet 07 passes its
 *   done-check, then it can graduate to production.
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
  const isDevelopment = env === "development";
  return {
    playlists: false,
    marathon: false,
    momentSearch: isDevelopment,
    anniversaryCapsule: false,
    memoryNotes: false,
  };
}

/** Ambient snapshot for the current runtime environment. */
export const featureFlags: FeatureFlags = resolveFeatureFlags();
