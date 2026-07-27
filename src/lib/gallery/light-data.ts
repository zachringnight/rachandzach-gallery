import lightArtifact from "@/generated/photo-light.json";
import type { LightLookup, PhotoLightSample } from "@/lib/gallery/archive-light";

/**
 * The committed light cache (design upgrade P3/P4), produced locally by
 * scripts/sample-photo-light.mjs from the import pipeline's preview
 * derivatives and keyed by imageDataHash. This module is the ONLY reader;
 * the long-term home for these values is a cached column written at import
 * time once that migration is authorized.
 *
 * Photos without an entry (e.g. approved guest uploads processed after the
 * artifact was generated) simply have no sampled light: they never join a
 * burst stack and contribute nothing to the Light Bar's tints. Both
 * consumers are built to degrade to that.
 */

const samples: Record<string, PhotoLightSample> = (
  lightArtifact as { photos: Record<string, PhotoLightSample> }
).photos;

export const lookupPhotoLight: LightLookup = (imageKey) =>
  samples[imageKey] ?? null;
