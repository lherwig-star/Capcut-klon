export type MediaKind = "video" | "audio" | "image";

/** An imported media file, probed for metadata and available for use in clips. */
export interface MediaAsset {
  id: string;
  kind: MediaKind;
  name: string;
  /** Absolute path on disk. */
  path: string;
  /** Playable URL (Tauri asset protocol) pointing at `path`. */
  url: string;
  /** 0 for images. */
  durationSec: number;
  width?: number;
  height?: number;
  /** Data URL preview image. */
  thumbnailUrl?: string;
}

export type TrackKind = "video" | "audio";

/** A single instance of a media asset placed on the timeline. */
export interface Clip {
  id: string;
  assetId: string;
  trackId: string;
  /** Position on the timeline, in seconds. */
  start: number;
  /** Visible length on the timeline, in seconds (= outPoint - inPoint). */
  duration: number;
  /** Trim in-point within the source asset, in seconds. */
  inPoint: number;
  /** Trim out-point within the source asset, in seconds. */
  outPoint: number;
}

export interface Track {
  id: string;
  kind: TrackKind;
  name: string;
  clips: Clip[];
  muted: boolean;
  hidden: boolean;
}

export interface TimelineState {
  tracks: Track[];
  playheadSec: number;
  zoomPxPerSec: number;
  selectedClipId: string | null;
}
