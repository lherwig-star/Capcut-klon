import { act, render } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaAsset } from "../../shared/types";
import { useTimeline } from "../timeline/useTimeline";
import { usePreviewEngine } from "./usePreviewEngine";

/**
 * A controllable clock shared by performance.now() and requestAnimationFrame, so a test
 * can step the render loop frame by frame instead of waiting on real time.
 */
let now = 0;
let frameCallbacks: FrameRequestCallback[] = [];

function advanceFrames(count: number, msPerFrame = 16) {
  for (let i = 0; i < count; i += 1) {
    const due = frameCallbacks;
    frameCallbacks = [];
    now += msPerFrame;
    for (const cb of due) cb(now);
  }
}

const VIDEO: MediaAsset = {
  id: "v1",
  kind: "video",
  name: "clip.mp4",
  path: "/tmp/clip.mp4",
  url: "asset:///tmp/clip.mp4",
  durationSec: 30,
  width: 320,
  height: 240,
};

interface HarnessHandle {
  playheadSec: number;
  isPlaying: boolean;
  durationSec: number;
  togglePlay: () => void;
  seek: (sec: number) => void;
  addClip: (start: number, duration: number) => void;
  trackId: string;
}

let handle: HarnessHandle;

function Harness({ assets }: { assets: MediaAsset[] }) {
  const api = useTimeline();
  const preview = usePreviewEngine(api.timeline, assets, api.durationSec, api.setPlayhead);
  const trackId = api.timeline.tracks.find((t) => t.kind === "video")!.id;

  // Published from an effect rather than during render: the test reads this after
  // Testing Library has committed, and writing to it mid-render is the kind of side
  // effect the app itself must not do either.
  useEffect(() => {
    handle = {
      playheadSec: api.timeline.playheadSec,
      isPlaying: preview.isPlaying,
      durationSec: api.durationSec,
      togglePlay: preview.togglePlay,
      seek: preview.seek,
      addClip: (start, duration) => api.addClip(trackId, VIDEO.id, start, duration, 0, duration),
      trackId,
    };
  });

  const { canvasRef } = preview;
  return <canvas ref={canvasRef} width={640} height={360} />;
}

beforeEach(() => {
  now = 0;
  frameCallbacks = [];

  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    frameCallbacks.push(cb);
    return frameCallbacks.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("usePreviewEngine playback", () => {
  it("advances the playhead across many frames", () => {
    render(<Harness assets={[VIDEO]} />);
    act(() => handle.addClip(0, 10));
    act(() => handle.togglePlay());

    expect(handle.isPlaying).toBe(true);
    act(() => advanceFrames(60, 16));

    // 60 frames of 16ms is 0.96s; allow a frame of slack either way.
    expect(handle.playheadSec).toBeGreaterThan(0.9);
    expect(handle.playheadSec).toBeLessThan(1.05);
  });

  it("keeps advancing even though every frame produces a new timeline object", () => {
    // The regression this pins down: the loop used to live in an effect that depended on
    // a callback memoised on [timeline]. Each frame's setPlayhead rebuilt that callback,
    // restarting the loop with a reset frame clock, so every tick measured a zero delta
    // and the playhead never moved.
    render(<Harness assets={[VIDEO]} />);
    act(() => handle.addClip(0, 10));
    act(() => handle.togglePlay());

    act(() => advanceFrames(10, 16));
    const afterTen = handle.playheadSec;
    act(() => advanceFrames(10, 16));
    const afterTwenty = handle.playheadSec;

    expect(afterTen).toBeGreaterThan(0);
    expect(afterTwenty).toBeGreaterThan(afterTen);
  });

  it("stops at the end of the timeline", () => {
    render(<Harness assets={[VIDEO]} />);
    act(() => handle.addClip(0, 1));
    act(() => handle.togglePlay());
    act(() => advanceFrames(100, 16));

    expect(handle.isPlaying).toBe(false);
    expect(handle.playheadSec).toBeCloseTo(1, 5);
  });

  it("restarts from the beginning when play is pressed at the end", () => {
    render(<Harness assets={[VIDEO]} />);
    act(() => handle.addClip(0, 1));
    act(() => handle.togglePlay());
    act(() => advanceFrames(100, 16));
    expect(handle.isPlaying).toBe(false);

    act(() => handle.togglePlay());
    expect(handle.playheadSec).toBe(0);
    expect(handle.isPlaying).toBe(true);
  });

  it("pauses without moving the playhead further", () => {
    render(<Harness assets={[VIDEO]} />);
    act(() => handle.addClip(0, 10));
    act(() => handle.togglePlay());
    act(() => advanceFrames(20, 16));

    act(() => handle.togglePlay());
    const atPause = handle.playheadSec;
    act(() => advanceFrames(20, 16));

    expect(handle.isPlaying).toBe(false);
    expect(handle.playheadSec).toBe(atPause);
  });

  it("does not start playing an empty timeline", () => {
    render(<Harness assets={[VIDEO]} />);
    act(() => handle.togglePlay());
    expect(handle.isPlaying).toBe(false);
  });

  it("clamps a seek to the timeline bounds", () => {
    render(<Harness assets={[VIDEO]} />);
    act(() => handle.addClip(0, 5));

    act(() => handle.seek(99));
    expect(handle.playheadSec).toBe(5);

    act(() => handle.seek(-3));
    expect(handle.playheadSec).toBe(0);
  });

  it("keeps playing from a new position when seeking mid-playback", () => {
    render(<Harness assets={[VIDEO]} />);
    act(() => handle.addClip(0, 20));
    act(() => handle.togglePlay());
    act(() => advanceFrames(10, 16));

    act(() => handle.seek(10));
    act(() => advanceFrames(10, 16));

    expect(handle.isPlaying).toBe(true);
    expect(handle.playheadSec).toBeGreaterThan(10);
  });
});
