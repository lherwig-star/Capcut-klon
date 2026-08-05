import { describe, expect, it, vi } from "vitest";
import type { TimelineState } from "../../shared/types";
import { createInitialTimeline, timelineReducer } from "../timeline/timelineReducer";
import { drawContain, findActiveClip } from "./compositor";

function withClip(start: number, duration: number): { state: TimelineState; trackId: string } {
  const initial = createInitialTimeline();
  const trackId = initial.tracks.find((t) => t.kind === "video")!.id;
  const state = timelineReducer(initial, {
    type: "add-clip",
    trackId,
    assetId: "a1",
    start,
    duration,
    inPoint: 0,
    outPoint: duration,
  });
  return { state, trackId };
}

describe("findActiveClip", () => {
  it("finds the clip under the playhead", () => {
    const { state, trackId } = withClip(2, 5);
    expect(findActiveClip(state, trackId, 3)).not.toBeNull();
  });

  it("treats the clip start as inside and its end as outside", () => {
    const { state, trackId } = withClip(2, 5);
    expect(findActiveClip(state, trackId, 2)).not.toBeNull();
    expect(findActiveClip(state, trackId, 7)).toBeNull();
  });

  it("returns null in a gap and on an unknown track", () => {
    const { state, trackId } = withClip(2, 5);
    expect(findActiveClip(state, trackId, 0)).toBeNull();
    expect(findActiveClip(state, "nope", 3)).toBeNull();
  });
});

describe("drawContain", () => {
  function fakeCtx() {
    return { drawImage: vi.fn() } as unknown as CanvasRenderingContext2D;
  }

  it("letterboxes a wider-than-target source", () => {
    const ctx = fakeCtx();
    drawContain(ctx, {} as CanvasImageSource, 200, 100, 100, 100);
    // scale 0.5 -> 100x50, centred vertically
    expect(ctx.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 25, 100, 50);
  });

  it("pillarboxes a taller-than-target source", () => {
    const ctx = fakeCtx();
    drawContain(ctx, {} as CanvasImageSource, 100, 200, 100, 100);
    expect(ctx.drawImage).toHaveBeenCalledWith(expect.anything(), 25, 0, 50, 100);
  });

  it("draws nothing for a source that has no dimensions yet", () => {
    const ctx = fakeCtx();
    drawContain(ctx, {} as CanvasImageSource, 0, 0, 100, 100);
    expect(ctx.drawImage).not.toHaveBeenCalled();
  });
});
