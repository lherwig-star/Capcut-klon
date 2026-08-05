import { describe, expect, it } from "vitest";
import type { TimelineState } from "../../shared/types";
import {
  createInitialTimeline,
  getTimelineDuration,
  timelineReducer,
  type TimelineAction,
} from "./timelineReducer";

function run(state: TimelineState, ...actions: TimelineAction[]): TimelineState {
  return actions.reduce(timelineReducer, state);
}

function videoTrackId(state: TimelineState): string {
  return state.tracks.find((t) => t.kind === "video")!.id;
}

function audioTrackId(state: TimelineState): string {
  return state.tracks.find((t) => t.kind === "audio")!.id;
}

function addClip(
  state: TimelineState,
  trackId: string,
  start: number,
  duration: number,
  assetId = "asset-1",
): TimelineState {
  return timelineReducer(state, {
    type: "add-clip",
    trackId,
    assetId,
    start,
    duration,
    inPoint: 0,
    outPoint: duration,
  });
}

function clipsOf(state: TimelineState, trackId: string) {
  return state.tracks.find((t) => t.id === trackId)!.clips;
}

describe("add-clip", () => {
  it("places a clip and selects it", () => {
    const initial = createInitialTimeline();
    const track = videoTrackId(initial);
    const state = addClip(initial, track, 2, 5);

    expect(clipsOf(state, track)).toHaveLength(1);
    expect(clipsOf(state, track)[0]).toMatchObject({ start: 2, duration: 5, inPoint: 0, outPoint: 5 });
    expect(state.selectedClipId).toBe(clipsOf(state, track)[0].id);
  });

  it("keeps clips sorted by start time", () => {
    const initial = createInitialTimeline();
    const track = videoTrackId(initial);
    const state = run(initial, ...[]);
    const withClips = addClip(addClip(state, track, 10, 2), track, 1, 2);

    expect(clipsOf(withClips, track).map((c) => c.start)).toEqual([1, 10]);
  });

  it("rejects a clip that would overlap an existing one", () => {
    const initial = createInitialTimeline();
    const track = videoTrackId(initial);
    const withOne = addClip(initial, track, 0, 5);
    const attempted = addClip(withOne, track, 3, 5);

    expect(clipsOf(attempted, track)).toHaveLength(1);
  });

  it("allows a clip that starts exactly where the previous ends", () => {
    const initial = createInitialTimeline();
    const track = videoTrackId(initial);
    const state = addClip(addClip(initial, track, 0, 5), track, 5, 5);

    expect(clipsOf(state, track)).toHaveLength(2);
  });

  it("never places a clip at a negative start", () => {
    const initial = createInitialTimeline();
    const track = videoTrackId(initial);
    const state = addClip(initial, track, -10, 4);

    expect(clipsOf(state, track)[0].start).toBe(0);
  });
});

describe("move-clip", () => {
  it("moves a clip within its track", () => {
    const initial = createInitialTimeline();
    const track = videoTrackId(initial);
    const state = addClip(initial, track, 0, 5);
    const clipId = clipsOf(state, track)[0].id;

    const moved = timelineReducer(state, { type: "move-clip", clipId, trackId: track, start: 12 });
    expect(clipsOf(moved, track)[0].start).toBe(12);
  });

  it("refuses to move a clip onto another one", () => {
    const initial = createInitialTimeline();
    const track = videoTrackId(initial);
    const state = addClip(addClip(initial, track, 0, 5), track, 10, 5);
    const first = clipsOf(state, track)[0];

    const moved = timelineReducer(state, { type: "move-clip", clipId: first.id, trackId: track, start: 11 });
    expect(clipsOf(moved, track)[0].start).toBe(0);
  });

  it("refuses to move a video clip onto an audio track", () => {
    const initial = createInitialTimeline();
    const video = videoTrackId(initial);
    const audio = audioTrackId(initial);
    const state = addClip(initial, video, 0, 5);
    const clipId = clipsOf(state, video)[0].id;

    const moved = timelineReducer(state, { type: "move-clip", clipId, trackId: audio, start: 0 });
    expect(clipsOf(moved, video)).toHaveLength(1);
    expect(clipsOf(moved, audio)).toHaveLength(0);
  });

  it("moves a clip to another track of the same kind and updates its trackId", () => {
    const initial = createInitialTimeline();
    const withSecond = timelineReducer(initial, { type: "add-track", kind: "video" });
    const [source, target] = withSecond.tracks.filter((t) => t.kind === "video");
    const state = addClip(withSecond, source.id, 0, 5);
    const clipId = clipsOf(state, source.id)[0].id;

    const moved = timelineReducer(state, { type: "move-clip", clipId, trackId: target.id, start: 3 });

    expect(clipsOf(moved, source.id)).toHaveLength(0);
    expect(clipsOf(moved, target.id)).toHaveLength(1);
    expect(clipsOf(moved, target.id)[0].trackId).toBe(target.id);
  });
});

describe("trim-clip", () => {
  it("trims the end and extends outPoint", () => {
    const initial = createInitialTimeline();
    const track = videoTrackId(initial);
    const state = addClip(initial, track, 0, 5);
    const clipId = clipsOf(state, track)[0].id;

    const trimmed = timelineReducer(state, {
      type: "trim-clip",
      clipId,
      edge: "end",
      deltaSec: 2,
      assetDurationSec: 10,
    });

    expect(clipsOf(trimmed, track)[0]).toMatchObject({ duration: 7, outPoint: 7 });
  });

  it("never extends the end past the source material", () => {
    const initial = createInitialTimeline();
    const track = videoTrackId(initial);
    const state = addClip(initial, track, 0, 5);
    const clipId = clipsOf(state, track)[0].id;

    const trimmed = timelineReducer(state, {
      type: "trim-clip",
      clipId,
      edge: "end",
      deltaSec: 100,
      assetDurationSec: 6,
    });

    expect(clipsOf(trimmed, track)[0].outPoint).toBe(6);
    expect(clipsOf(trimmed, track)[0].duration).toBe(6);
  });

  it("trims the start, moving start and inPoint together", () => {
    const initial = createInitialTimeline();
    const track = videoTrackId(initial);
    const state = addClip(initial, track, 4, 5);
    const clipId = clipsOf(state, track)[0].id;

    const trimmed = timelineReducer(state, {
      type: "trim-clip",
      clipId,
      edge: "start",
      deltaSec: 2,
      assetDurationSec: 10,
    });

    expect(clipsOf(trimmed, track)[0]).toMatchObject({ start: 6, duration: 3, inPoint: 2 });
  });

  it("never pulls the start before the source material", () => {
    const initial = createInitialTimeline();
    const track = videoTrackId(initial);
    const state = addClip(initial, track, 4, 5);
    const clipId = clipsOf(state, track)[0].id;

    const trimmed = timelineReducer(state, {
      type: "trim-clip",
      clipId,
      edge: "start",
      deltaSec: -100,
      assetDurationSec: 10,
    });

    expect(clipsOf(trimmed, track)[0].inPoint).toBe(0);
  });

  it("keeps a trimmed clip from swallowing its neighbour", () => {
    const initial = createInitialTimeline();
    const track = videoTrackId(initial);
    const state = addClip(addClip(initial, track, 0, 5), track, 6, 5);
    const first = clipsOf(state, track)[0];

    const trimmed = timelineReducer(state, {
      type: "trim-clip",
      clipId: first.id,
      edge: "end",
      deltaSec: 4,
      assetDurationSec: 30,
    });

    expect(clipsOf(trimmed, track)[0].duration).toBe(5);
  });
});

describe("split-clip", () => {
  it("splits one clip into two adjacent halves", () => {
    const initial = createInitialTimeline();
    const track = videoTrackId(initial);
    const state = addClip(initial, track, 0, 10);
    const clipId = clipsOf(state, track)[0].id;

    const split = timelineReducer(state, { type: "split-clip", clipId, atSec: 4 });
    const [first, second] = clipsOf(split, track);

    expect(clipsOf(split, track)).toHaveLength(2);
    expect(first).toMatchObject({ start: 0, duration: 4, inPoint: 0, outPoint: 4 });
    expect(second).toMatchObject({ start: 4, duration: 6, inPoint: 4, outPoint: 10 });
  });

  it("carries the source offset of an already trimmed clip into both halves", () => {
    const initial = createInitialTimeline();
    const track = videoTrackId(initial);
    const state = timelineReducer(initial, {
      type: "add-clip",
      trackId: track,
      assetId: "asset-1",
      start: 0,
      duration: 10,
      inPoint: 5,
      outPoint: 15,
    });
    const clipId = clipsOf(state, track)[0].id;

    const split = timelineReducer(state, { type: "split-clip", clipId, atSec: 4 });
    const [first, second] = clipsOf(split, track);

    expect(first).toMatchObject({ inPoint: 5, outPoint: 9 });
    expect(second).toMatchObject({ inPoint: 9, outPoint: 15 });
  });

  it("ignores a split at the very edge of a clip", () => {
    const initial = createInitialTimeline();
    const track = videoTrackId(initial);
    const state = addClip(initial, track, 0, 10);
    const clipId = clipsOf(state, track)[0].id;

    expect(clipsOf(timelineReducer(state, { type: "split-clip", clipId, atSec: 0 }), track)).toHaveLength(1);
    expect(clipsOf(timelineReducer(state, { type: "split-clip", clipId, atSec: 10 }), track)).toHaveLength(1);
  });

  it("ignores a split outside the clip", () => {
    const initial = createInitialTimeline();
    const track = videoTrackId(initial);
    const state = addClip(initial, track, 0, 5);
    const clipId = clipsOf(state, track)[0].id;

    expect(clipsOf(timelineReducer(state, { type: "split-clip", clipId, atSec: 20 }), track)).toHaveLength(1);
  });
});

describe("remove-clip", () => {
  it("removes the clip and clears the selection", () => {
    const initial = createInitialTimeline();
    const track = videoTrackId(initial);
    const state = addClip(initial, track, 0, 5);
    const clipId = clipsOf(state, track)[0].id;

    const removed = timelineReducer(state, { type: "remove-clip", clipId });
    expect(clipsOf(removed, track)).toHaveLength(0);
    expect(removed.selectedClipId).toBeNull();
  });
});

describe("playhead and zoom", () => {
  it("clamps the playhead at zero", () => {
    const state = timelineReducer(createInitialTimeline(), { type: "set-playhead", sec: -5 });
    expect(state.playheadSec).toBe(0);
  });

  it("clamps the zoom into its range", () => {
    const low = timelineReducer(createInitialTimeline(), { type: "set-zoom", pxPerSec: 1 });
    const high = timelineReducer(createInitialTimeline(), { type: "set-zoom", pxPerSec: 9999 });
    expect(low.zoomPxPerSec).toBe(10);
    expect(high.zoomPxPerSec).toBe(400);
  });
});

describe("getTimelineDuration", () => {
  it("is zero for an empty timeline", () => {
    expect(getTimelineDuration(createInitialTimeline())).toBe(0);
  });

  it("reports the furthest clip end across all tracks", () => {
    const initial = createInitialTimeline();
    const video = videoTrackId(initial);
    const audio = audioTrackId(initial);
    const state = addClip(addClip(initial, video, 0, 5), audio, 10, 3);

    expect(getTimelineDuration(state)).toBe(13);
  });
});

describe("tracks", () => {
  it("numbers new tracks per kind", () => {
    const state = run(createInitialTimeline(), { type: "add-track", kind: "video" }, { type: "add-track", kind: "audio" });
    const names = state.tracks.map((t) => t.name);
    expect(names).toEqual(["Video 1", "Audio 1", "Video 2", "Audio 2"]);
  });

  it("toggles mute and visibility independently", () => {
    const initial = createInitialTimeline();
    const track = videoTrackId(initial);
    const muted = timelineReducer(initial, { type: "toggle-track-mute", trackId: track });
    const hidden = timelineReducer(muted, { type: "toggle-track-hidden", trackId: track });
    const result = hidden.tracks.find((t) => t.id === track)!;

    expect(result.muted).toBe(true);
    expect(result.hidden).toBe(true);
  });
});
