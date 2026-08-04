import type { MediaAsset } from "./types";

/** How far a clip may be trimmed before running out of source material. Images have no such limit. */
export function getAssetDurationBound(asset: MediaAsset): number {
  return asset.kind === "image" ? Number.POSITIVE_INFINITY : asset.durationSec;
}

const DEFAULT_IMAGE_CLIP_DURATION_SEC = 4;

/** Default length a freshly dropped clip gets on the timeline. */
export function getDefaultClipDuration(asset: MediaAsset): number {
  return asset.kind === "image" ? DEFAULT_IMAGE_CLIP_DURATION_SEC : asset.durationSec;
}
