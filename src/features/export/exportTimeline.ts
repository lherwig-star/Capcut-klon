import type { MediaAsset, TimelineState } from "../../shared/types";
import { buildFfmpegArgs, type FfmpegPlan } from "./buildFfmpegArgs";
import { probeAudioStreams, runExport, type ExportProgressPayload } from "./runExport";

export interface ExportTimelineOptions {
  outputPath: string;
  width: number;
  height: number;
  fps: number;
}

/**
 * Renders the timeline to a real video file: probes which assets carry audio (needed
 * before the filter graph can be built - see buildFfmpegArgs), then runs the render.
 * Shared by the export panel and anything else that needs a rendered file, such as
 * handing the current cut off to the subtitle tool, so both go through one path instead
 * of two that could drift apart.
 */
export async function exportTimeline(
  timeline: TimelineState,
  assets: MediaAsset[],
  options: ExportTimelineOptions,
  onProgress?: (payload: ExportProgressPayload) => void,
): Promise<FfmpegPlan> {
  const probed = await probeAudioStreams(assets.map((asset) => asset.path));
  const assetsWithAudio = assets.map((asset, index) => ({ ...asset, hasAudio: probed[index] ?? false }));
  const plan = buildFfmpegArgs(timeline, assetsWithAudio, options);
  await runExport(plan.args, plan.totalSeconds, onProgress ?? (() => {}));
  return plan;
}
