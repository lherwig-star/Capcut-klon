import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { MediaAsset, TimelineState } from "../../shared/types";
import { createInitialTimeline, timelineReducer } from "../timeline/timelineReducer";
import { buildFfmpegArgs } from "./buildFfmpegArgs";

const ffmpegAvailable = spawnSync("ffmpeg", ["-version"]).status === 0;
/** ffmpeg is not on the CI runners; the graph is only executable where it exists. */
const withFfmpeg = ffmpegAvailable ? describe : describe.skip;

let workdir: string;
let videoPath: string;
let audioPath: string;
let imagePath: string;

function makeAssets(): MediaAsset[] {
  return [
    {
      id: "v1",
      kind: "video",
      name: "clip.mp4",
      path: videoPath,
      url: `asset://${videoPath}`,
      durationSec: 10,
      width: 320,
      height: 240,
      hasAudio: true,
    },
    {
      id: "a1",
      kind: "audio",
      name: "music.mp3",
      path: audioPath,
      url: `asset://${audioPath}`,
      durationSec: 8,
      hasAudio: true,
    },
    {
      id: "i1",
      kind: "image",
      name: "pic.png",
      path: imagePath,
      url: `asset://${imagePath}`,
      durationSec: 0,
      width: 320,
      height: 240,
    },
  ];
}

function videoTrack(state: TimelineState) {
  return state.tracks.find((t) => t.kind === "video")!;
}
function audioTrack(state: TimelineState) {
  return state.tracks.find((t) => t.kind === "audio")!;
}

function place(
  state: TimelineState,
  trackId: string,
  assetId: string,
  start: number,
  duration: number,
  inPoint = 0,
): TimelineState {
  return timelineReducer(state, {
    type: "add-clip",
    trackId,
    assetId,
    start,
    duration,
    inPoint,
    outPoint: inPoint + duration,
  });
}

/** Runs the produced args and returns ffmpeg's stderr when it fails, or null on success. */
function runFfmpeg(args: string[]): string | null {
  const result = spawnSync("ffmpeg", args, { encoding: "utf-8", timeout: 120_000 });
  return result.status === 0 ? null : `exit ${result.status}\n${result.stderr?.slice(-2500)}`;
}

function probeStreams(path: string): string[] {
  const out = execFileSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "stream=codec_type", "-of", "csv=p=0", path],
    { encoding: "utf-8" },
  );
  return out.split("\n").map((line) => line.trim()).filter(Boolean);
}

function probeDuration(path: string): number {
  const out = execFileSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
    { encoding: "utf-8" },
  );
  return Number.parseFloat(out.trim());
}

beforeAll(() => {
  if (!ffmpegAvailable) return;
  workdir = mkdtempSync(join(tmpdir(), "capcut-export-"));
  videoPath = join(workdir, "clip.mp4");
  audioPath = join(workdir, "music.mp3");
  imagePath = join(workdir, "pic.png");

  execFileSync("ffmpeg", [
    "-y", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=25:duration=10",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=10",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", videoPath,
  ]);
  execFileSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "sine=frequency=220:duration=8", audioPath]);
  execFileSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=red:size=320x240", "-frames:v", "1", imagePath]);
});

describe("buildFfmpegArgs", () => {
  it("passes each source file to ffmpeg exactly once", () => {
    const assets = makeAssets();
    let state = createInitialTimeline();
    const track = videoTrack(state).id;
    state = place(state, track, "v1", 0, 3);
    state = place(state, track, "v1", 3, 3, 5);

    const { args } = buildFfmpegArgs(state, assets, {
      outputPath: "out.mp4",
      width: 320,
      height: 240,
      fps: 25,
    });

    const inputs = args.filter((_, i) => args[i - 1] === "-i");
    expect(inputs).toEqual([...new Set(inputs)]);
  });

  it("reports the timeline duration it renders", () => {
    const assets = makeAssets();
    let state = createInitialTimeline();
    state = place(state, videoTrack(state).id, "v1", 0, 4);

    const plan = buildFfmpegArgs(state, assets, {
      outputPath: "out.mp4",
      width: 320,
      height: 240,
      fps: 25,
    });
    expect(plan.totalSeconds).toBe(4);
  });
});

withFfmpeg("buildFfmpegArgs against a real ffmpeg", () => {
  it("renders a single video clip", () => {
    const assets = makeAssets();
    let state = createInitialTimeline();
    state = place(state, videoTrack(state).id, "v1", 0, 4);
    const outputPath = join(workdir, "single.mp4");

    const { args } = buildFfmpegArgs(state, assets, { outputPath, width: 320, height: 240, fps: 25 });
    expect(runFfmpeg(args)).toBeNull();
    expect(existsSync(outputPath)).toBe(true);
    expect(probeDuration(outputPath)).toBeCloseTo(4, 0);
  });

  it("renders two clips cut from the same source file", () => {
    const assets = makeAssets();
    let state = createInitialTimeline();
    const track = videoTrack(state).id;
    state = place(state, track, "v1", 0, 3);
    state = place(state, track, "v1", 3, 3, 5);
    const outputPath = join(workdir, "same-source.mp4");

    const { args } = buildFfmpegArgs(state, assets, { outputPath, width: 320, height: 240, fps: 25 });
    expect(runFfmpeg(args)).toBeNull();
    expect(probeDuration(outputPath)).toBeCloseTo(6, 0);
  });

  it("renders a clip that was split in two", () => {
    const assets = makeAssets();
    let state = createInitialTimeline();
    const track = videoTrack(state).id;
    state = place(state, track, "v1", 0, 8);
    const clipId = state.tracks.find((t) => t.id === track)!.clips[0].id;
    state = timelineReducer(state, { type: "split-clip", clipId, atSec: 4 });
    const outputPath = join(workdir, "split.mp4");

    const { args } = buildFfmpegArgs(state, assets, { outputPath, width: 320, height: 240, fps: 25 });
    expect(runFfmpeg(args)).toBeNull();
    expect(probeDuration(outputPath)).toBeCloseTo(8, 0);
  });

  it("keeps the audio of a video clip", () => {
    const assets = makeAssets();
    let state = createInitialTimeline();
    state = place(state, videoTrack(state).id, "v1", 0, 4);
    const outputPath = join(workdir, "video-audio.mp4");

    const { args } = buildFfmpegArgs(state, assets, { outputPath, width: 320, height: 240, fps: 25 });
    expect(runFfmpeg(args)).toBeNull();
    expect(probeStreams(outputPath)).toContain("audio");
  });

  it("renders a silent source without referencing its missing audio pad", () => {
    // Pulling [n:a] off an input that has none aborts the whole render, so an unprobed or
    // silent asset must contribute no audio chain at all.
    const assets = makeAssets().map((asset) => ({ ...asset, hasAudio: false }));
    let state = createInitialTimeline();
    state = place(state, videoTrack(state).id, "v1", 0, 3);
    const outputPath = join(workdir, "silent.mp4");

    const { args } = buildFfmpegArgs(state, assets, { outputPath, width: 320, height: 240, fps: 25 });
    expect(runFfmpeg(args)).toBeNull();
    expect(probeStreams(outputPath)).not.toContain("audio");
  });

  it("drops the audio of a muted video track but keeps its picture", () => {
    const assets = makeAssets();
    let state = createInitialTimeline();
    const track = videoTrack(state).id;
    state = place(state, track, "v1", 0, 3);
    state = timelineReducer(state, { type: "toggle-track-mute", trackId: track });
    const outputPath = join(workdir, "muted-video.mp4");

    const { args } = buildFfmpegArgs(state, assets, { outputPath, width: 320, height: 240, fps: 25 });
    expect(runFfmpeg(args)).toBeNull();
    expect(probeStreams(outputPath)).toContain("video");
    expect(probeStreams(outputPath)).not.toContain("audio");
  });

  it("mixes a video clip's own audio together with an audio-track clip", () => {
    const assets = makeAssets();
    let state = createInitialTimeline();
    state = place(state, videoTrack(state).id, "v1", 0, 6);
    state = place(state, audioTrack(state).id, "a1", 2, 3);
    const outputPath = join(workdir, "both-audio.mp4");

    const { args } = buildFfmpegArgs(state, assets, { outputPath, width: 320, height: 240, fps: 25 });
    const filterGraph = args[args.indexOf("-filter_complex") + 1];

    expect(filterGraph).toMatch(/amix=inputs=2/);
    expect(runFfmpeg(args)).toBeNull();
    expect(probeStreams(outputPath)).toContain("audio");
  });

  it("mixes a music clip on the audio track", () => {
    const assets = makeAssets();
    let state = createInitialTimeline();
    state = place(state, videoTrack(state).id, "v1", 0, 6);
    state = place(state, audioTrack(state).id, "a1", 1, 4);
    const outputPath = join(workdir, "mixed.mp4");

    const { args } = buildFfmpegArgs(state, assets, { outputPath, width: 320, height: 240, fps: 25 });
    expect(runFfmpeg(args)).toBeNull();
    expect(probeStreams(outputPath)).toContain("audio");
  });

  it("renders an image clip", () => {
    const assets = makeAssets();
    let state = createInitialTimeline();
    state = place(state, videoTrack(state).id, "i1", 0, 3);
    const outputPath = join(workdir, "image.mp4");

    const { args } = buildFfmpegArgs(state, assets, { outputPath, width: 320, height: 240, fps: 25 });
    expect(runFfmpeg(args)).toBeNull();
    expect(probeDuration(outputPath)).toBeCloseTo(3, 0);
  });

  it("renders a gap between two clips as black", () => {
    const assets = makeAssets();
    let state = createInitialTimeline();
    const track = videoTrack(state).id;
    state = place(state, track, "v1", 0, 2);
    state = place(state, track, "v1", 5, 2);
    const outputPath = join(workdir, "gap.mp4");

    const { args } = buildFfmpegArgs(state, assets, { outputPath, width: 320, height: 240, fps: 25 });
    expect(runFfmpeg(args)).toBeNull();
    expect(probeDuration(outputPath)).toBeCloseTo(7, 0);
  });

  it("skips a hidden video track", () => {
    const assets = makeAssets();
    let state = createInitialTimeline();
    const track = videoTrack(state).id;
    state = place(state, track, "v1", 0, 3);
    state = timelineReducer(state, { type: "toggle-track-hidden", trackId: track });
    const outputPath = join(workdir, "hidden.mp4");

    const { args } = buildFfmpegArgs(state, assets, { outputPath, width: 320, height: 240, fps: 25 });
    expect(runFfmpeg(args)).toBeNull();
  });
});
