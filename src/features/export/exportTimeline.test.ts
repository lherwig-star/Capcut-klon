import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaAsset } from "../../shared/types";
import { createInitialTimeline } from "../timeline/timelineReducer";

const probeAudioStreams = vi.fn();
const runExport = vi.fn();

vi.mock("./runExport", () => ({
  probeAudioStreams: (...args: unknown[]) => probeAudioStreams(...args),
  runExport: (...args: unknown[]) => runExport(...args),
}));

const { exportTimeline } = await import("./exportTimeline");

function asset(id: string, hasAudio = false): MediaAsset {
  return {
    id,
    kind: "video",
    name: `${id}.mp4`,
    path: `/tmp/${id}.mp4`,
    url: `asset:///tmp/${id}.mp4`,
    durationSec: 5,
    hasAudio,
  };
}

beforeEach(() => {
  probeAudioStreams.mockReset().mockResolvedValue([]);
  runExport.mockReset().mockResolvedValue(undefined);
});

describe("exportTimeline", () => {
  it("probes the assets' paths before building the filter graph", async () => {
    const assets = [asset("a"), asset("b")];
    probeAudioStreams.mockResolvedValue([true, false]);

    await exportTimeline(createInitialTimeline(), assets, {
      outputPath: "/tmp/out.mp4",
      width: 640,
      height: 360,
      fps: 25,
    });

    expect(probeAudioStreams).toHaveBeenCalledWith(["/tmp/a.mp4", "/tmp/b.mp4"]);
  });

  it("hands the rendered args and duration to runExport", async () => {
    await exportTimeline(createInitialTimeline(), [], {
      outputPath: "/tmp/out.mp4",
      width: 640,
      height: 360,
      fps: 25,
    });

    expect(runExport).toHaveBeenCalledTimes(1);
    const [args, totalSeconds] = runExport.mock.calls[0];
    expect(args).toContain("/tmp/out.mp4");
    expect(totalSeconds).toBe(0);
  });

  it("forwards progress updates to the caller", async () => {
    runExport.mockImplementation(async (_args: string[], _total: number, onProgress: (p: unknown) => void) => {
      onProgress({ secondsDone: 2, totalSeconds: 4 });
    });
    const onProgress = vi.fn();

    await exportTimeline(
      createInitialTimeline(),
      [],
      { outputPath: "/tmp/out.mp4", width: 640, height: 360, fps: 25 },
      onProgress,
    );

    expect(onProgress).toHaveBeenCalledWith({ secondsDone: 2, totalSeconds: 4 });
  });

  it("works without a progress callback", async () => {
    await expect(
      exportTimeline(createInitialTimeline(), [], { outputPath: "/tmp/out.mp4", width: 640, height: 360, fps: 25 }),
    ).resolves.toBeDefined();
  });

  it("propagates a failed render instead of swallowing it", async () => {
    runExport.mockRejectedValue(new Error("ffmpeg wurde mit Status 1 beendet"));

    await expect(
      exportTimeline(createInitialTimeline(), [], { outputPath: "/tmp/out.mp4", width: 640, height: 360, fps: 25 }),
    ).rejects.toThrow(/Status 1/);
  });
});
