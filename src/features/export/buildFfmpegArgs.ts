import type { MediaAsset, TimelineState } from "../../shared/types";
import { getTimelineDuration } from "../timeline/timelineReducer";

export interface ExportOptions {
  outputPath: string;
  width: number;
  height: number;
  fps: number;
}

export interface FfmpegPlan {
  args: string[];
  totalSeconds: number;
}

/**
 * Translates the timeline into an ffmpeg filter_complex graph: a black base canvas with each
 * video clip overlaid during its [start, end) window, and an amix of the audio-track clips.
 * v1 scope: only clips on explicit "audio" tracks contribute sound - audio embedded in video
 * clips is dropped here until features/audio-editor's mixing lands.
 */
export function buildFfmpegArgs(timeline: TimelineState, assets: MediaAsset[], options: ExportOptions): FfmpegPlan {
  const totalSeconds = getTimelineDuration(timeline);
  const { outputPath, width, height, fps } = options;

  const assetOrder: string[] = [];
  const assetIndex = new Map<string, number>();
  function inputIndexFor(assetId: string): number {
    let idx = assetIndex.get(assetId);
    if (idx === undefined) {
      idx = assetOrder.length;
      assetOrder.push(assetId);
      assetIndex.set(assetId, idx);
    }
    return idx;
  }

  const filterParts: string[] = [`color=c=black:s=${width}x${height}:d=${totalSeconds.toFixed(3)}[base]`];

  let videoLabel = "base";
  let videoStageCount = 0;
  for (const track of timeline.tracks) {
    if (track.kind !== "video" || track.hidden) continue;
    for (const clip of track.clips) {
      const asset = assets.find((a) => a.id === clip.assetId);
      if (!asset) continue;
      const inputIdx = inputIndexFor(asset.id);
      const clipLabel = `v${videoStageCount}`;
      const start = clip.start.toFixed(3);
      const end = (clip.start + clip.duration).toFixed(3);

      if (asset.kind === "image") {
        filterParts.push(
          `[${inputIdx}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
            `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,` +
            `trim=duration=${clip.duration.toFixed(3)},setpts=PTS-STARTPTS+${start}/TB[${clipLabel}]`,
        );
      } else {
        filterParts.push(
          `[${inputIdx}:v]trim=start=${clip.inPoint.toFixed(3)}:end=${clip.outPoint.toFixed(3)},` +
            `setpts=PTS-STARTPTS+${start}/TB,scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
            `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1[${clipLabel}]`,
        );
      }

      const stageLabel = `stage${videoStageCount}`;
      filterParts.push(`[${videoLabel}][${clipLabel}]overlay=enable='between(t,${start},${end})'[${stageLabel}]`);
      videoLabel = stageLabel;
      videoStageCount += 1;
    }
  }
  filterParts.push(`[${videoLabel}]null[vout]`);

  const audioLabels: string[] = [];
  let audioStageCount = 0;
  for (const track of timeline.tracks) {
    if (track.kind !== "audio" || track.muted) continue;
    for (const clip of track.clips) {
      const asset = assets.find((a) => a.id === clip.assetId);
      if (!asset || asset.kind !== "audio") continue;
      const inputIdx = inputIndexFor(asset.id);
      const label = `a${audioStageCount}`;
      const delayMs = Math.max(0, Math.round(clip.start * 1000));
      filterParts.push(
        `[${inputIdx}:a]atrim=start=${clip.inPoint.toFixed(3)}:end=${clip.outPoint.toFixed(3)},` +
          `asetpts=PTS-STARTPTS,adelay=delays=${delayMs}:all=1[${label}]`,
      );
      audioLabels.push(label);
      audioStageCount += 1;
    }
  }

  const hasAudio = audioLabels.length > 0;
  if (hasAudio) {
    filterParts.push(
      `${audioLabels.map((label) => `[${label}]`).join("")}amix=inputs=${audioLabels.length}:duration=longest:normalize=0[aout]`,
    );
  }

  const inputArgs = assetOrder.flatMap((assetId) => {
    const asset = assets.find((a) => a.id === assetId);
    if (!asset) return [];
    return asset.kind === "image" ? ["-loop", "1", "-i", asset.path] : ["-i", asset.path];
  });

  const args = [
    "-y",
    ...inputArgs,
    "-filter_complex",
    filterParts.join(";"),
    "-map",
    "[vout]",
    ...(hasAudio ? ["-map", "[aout]"] : []),
    "-r",
    String(fps),
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    ...(hasAudio ? ["-c:a", "aac"] : []),
    "-t",
    totalSeconds.toFixed(3),
    outputPath,
  ];

  return { args, totalSeconds };
}
