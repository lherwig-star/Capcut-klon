import type { Clip, TimelineState } from "../../shared/types";

export function findActiveClip(timeline: TimelineState, trackId: string, atSec: number): Clip | null {
  const track = timeline.tracks.find((t) => t.id === trackId);
  if (!track) return null;
  return track.clips.find((clip) => atSec >= clip.start && atSec < clip.start + clip.duration) ?? null;
}

/** Draws `source` into the canvas context, scaled to fit while preserving aspect ratio (letterboxed). */
export function drawContain(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
) {
  if (!sourceWidth || !sourceHeight) return;
  const scale = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  const dx = (targetWidth - drawWidth) / 2;
  const dy = (targetHeight - drawHeight) / 2;
  ctx.drawImage(source, dx, dy, drawWidth, drawHeight);
}
