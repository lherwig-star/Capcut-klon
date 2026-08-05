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
 * video clip overlaid during its [start, end) window, plus an amix carrying both the audio of
 * the video clips themselves and whatever sits on the audio tracks.
 *
 * A video clip only contributes sound when its asset is known to have an audio stream.
 * Referencing the audio pad of a silent file is not a warning but a hard failure that takes
 * the entire render with it, so `hasAudio: undefined` is treated as "no" - callers that care
 * probe first (see probeAudioStreams).
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
  const audioLabels: string[] = [];
  let audioStageCount = 0;

  /** Trims a clip's slice out of an input's audio and slides it to its timeline position. */
  function addAudioChain(inputIdx: number, clip: { start: number; inPoint: number; outPoint: number }) {
    const label = `a${audioStageCount}`;
    const delayMs = Math.max(0, Math.round(clip.start * 1000));
    filterParts.push(
      `[${inputIdx}:a]atrim=start=${clip.inPoint.toFixed(3)}:end=${clip.outPoint.toFixed(3)},` +
        `asetpts=PTS-STARTPTS,adelay=delays=${delayMs}:all=1[${label}]`,
    );
    audioLabels.push(label);
    audioStageCount += 1;
  }

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

      if (asset.kind === "video" && asset.hasAudio && !track.muted) {
        addAudioChain(inputIdx, clip);
      }

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

  for (const track of timeline.tracks) {
    if (track.kind !== "audio" || track.muted) continue;
    for (const clip of track.clips) {
      const asset = assets.find((a) => a.id === clip.assetId);
      if (!asset || asset.kind !== "audio") continue;
      addAudioChain(inputIndexFor(asset.id), clip);
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
