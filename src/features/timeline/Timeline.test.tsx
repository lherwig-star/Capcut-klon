import { fireEvent, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { MEDIA_ASSET_DRAG_TYPE } from "../../shared/dragTypes";
import type { MediaAsset } from "../../shared/types";
import { Timeline } from "./Timeline";
import { useTimeline, type UseTimelineReturn } from "./useTimeline";

const VIDEO: MediaAsset = {
  id: "v1",
  kind: "video",
  name: "clip.mp4",
  path: "/tmp/clip.mp4",
  url: "asset:///tmp/clip.mp4",
  durationSec: 20,
};

let api: UseTimelineReturn;

function Harness({ assets }: { assets: MediaAsset[] }) {
  const timelineApi = useTimeline();
  // Published from an effect: assigning during render would be a side effect, and the
  // test only reads it after Testing Library has committed anyway.
  useEffect(() => {
    api = timelineApi;
  });
  return <Timeline assets={assets} timelineApi={timelineApi} />;
}

/**
 * jsdom lays nothing out, so every getBoundingClientRect is zeroed. The timeline converts
 * pointer positions into seconds against those rects; without a stub every click reads as
 * time zero and no seek could ever be observed.
 */
function stubLaneGeometry(container: HTMLElement, left = 0) {
  const targets = [
    ...container.querySelectorAll(".timeline__ruler-wrap"),
    ...container.querySelectorAll(".track-row__lane"),
  ];
  for (const el of targets) {
    el.getBoundingClientRect = () => ({ left, top: 0, right: 2000, bottom: 56, width: 2000, height: 56, x: left, y: 0, toJSON: () => ({}) });
  }
}

function dropAsset(lane: Element, clientX: number) {
  const data = new Map<string, string>([[MEDIA_ASSET_DRAG_TYPE, VIDEO.id]]);
  const dataTransfer = {
    types: [MEDIA_ASSET_DRAG_TYPE],
    getData: (type: string) => data.get(type) ?? "",
    dropEffect: "",
  };
  fireEvent.dragOver(lane, { dataTransfer });
  fireEvent.drop(lane, { dataTransfer, clientX });
}

function videoLane(container: HTMLElement): Element {
  return container.querySelectorAll(".track-row__lane")[0];
}

let container: HTMLElement;

beforeEach(() => {
  const rendered = render(<Harness assets={[VIDEO]} />);
  container = rendered.container;
  stubLaneGeometry(container);
});

describe("dropping media onto a track", () => {
  it("creates a clip at the drop position", () => {
    dropAsset(videoLane(container), 120);

    const clips = api.timeline.tracks[0].clips;
    expect(clips).toHaveLength(1);
    // 120px at the default 60px/s
    expect(clips[0].start).toBeCloseTo(2, 5);
    expect(clips[0].duration).toBe(VIDEO.durationSec);
  });

  it("ignores a drag that carries no asset", () => {
    const lane = videoLane(container);
    const dataTransfer = { types: ["text/plain"], getData: () => "", dropEffect: "" };
    fireEvent.dragOver(lane, { dataTransfer });
    fireEvent.drop(lane, { dataTransfer, clientX: 100 });

    expect(api.timeline.tracks[0].clips).toHaveLength(0);
  });
});

describe("moving the playhead", () => {
  it("seeks when the ruler is clicked", () => {
    const ruler = container.querySelector(".timeline__ruler-wrap")!;
    fireEvent.pointerDown(ruler, { clientX: 180, pointerId: 1 });

    expect(api.timeline.playheadSec).toBeCloseTo(3, 5);
  });

  it("keeps following the pointer while scrubbing", () => {
    const ruler = container.querySelector(".timeline__ruler-wrap")!;
    fireEvent.pointerDown(ruler, { clientX: 60, pointerId: 1 });
    fireEvent.pointerMove(ruler, { clientX: 300, pointerId: 1 });

    expect(api.timeline.playheadSec).toBeCloseTo(5, 5);
  });

  it("stops following once the pointer is released", () => {
    const ruler = container.querySelector(".timeline__ruler-wrap")!;
    fireEvent.pointerDown(ruler, { clientX: 60, pointerId: 1 });
    fireEvent.pointerUp(ruler, { clientX: 60, pointerId: 1 });
    fireEvent.pointerMove(ruler, { clientX: 600, pointerId: 1 });

    expect(api.timeline.playheadSec).toBeCloseTo(1, 5);
  });

  it("seeks when empty track space is clicked", () => {
    fireEvent.pointerDown(videoLane(container), { clientX: 240, pointerId: 1 });
    expect(api.timeline.playheadSec).toBeCloseTo(4, 5);
  });

  it("does not seek when the press landed on a clip", () => {
    dropAsset(videoLane(container), 0);
    const clip = container.querySelector(".clip-block")!;

    fireEvent.pointerDown(clip, { clientX: 300, pointerId: 1 });

    expect(api.timeline.playheadSec).toBe(0);
  });
});

describe("toolbar", () => {
  it("splits the selected clip at the playhead", () => {
    dropAsset(videoLane(container), 0);
    fireEvent.pointerDown(container.querySelector(".timeline__ruler-wrap")!, { clientX: 300, pointerId: 1 });

    fireEvent.click(screen.getByRole("button", { name: /Trennen/ }));

    expect(api.timeline.tracks[0].clips).toHaveLength(2);
  });

  it("deletes the selected clip", () => {
    dropAsset(videoLane(container), 0);
    expect(api.timeline.tracks[0].clips).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: /Löschen/ }));

    expect(api.timeline.tracks[0].clips).toHaveLength(0);
  });

  it("keeps split and delete disabled while nothing is selected", () => {
    expect(screen.getByRole("button", { name: /Trennen/ })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: /Löschen/ })).toHaveProperty("disabled", true);
  });

  it("adds tracks of each kind", () => {
    fireEvent.click(screen.getByRole("button", { name: /Video-Spur/ }));
    fireEvent.click(screen.getByRole("button", { name: /Audio-Spur/ }));

    expect(api.timeline.tracks.map((t) => t.name)).toEqual(["Video 1", "Audio 1", "Video 2", "Audio 2"]);
  });
});

describe("keyboard", () => {
  it("removes the selected clip on Delete", () => {
    dropAsset(videoLane(container), 0);
    fireEvent.keyDown(window, { key: "Delete" });

    expect(api.timeline.tracks[0].clips).toHaveLength(0);
  });

  it("splits the selected clip on S", () => {
    dropAsset(videoLane(container), 0);
    fireEvent.pointerDown(container.querySelector(".timeline__ruler-wrap")!, { clientX: 300, pointerId: 1 });
    fireEvent.keyDown(window, { key: "s" });

    expect(api.timeline.tracks[0].clips).toHaveLength(2);
  });

  it("leaves clips alone while typing in a text field", () => {
    dropAsset(videoLane(container), 0);
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    fireEvent.keyDown(input, { key: "Delete" });

    expect(api.timeline.tracks[0].clips).toHaveLength(1);
    input.remove();
  });
});
