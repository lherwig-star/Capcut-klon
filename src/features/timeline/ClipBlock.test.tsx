import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Clip, MediaAsset } from "../../shared/types";
import { ClipBlock } from "./ClipBlock";

const ASSET: MediaAsset = {
  id: "a1",
  kind: "video",
  name: "clip.mp4",
  path: "/tmp/clip.mp4",
  url: "asset:///tmp/clip.mp4",
  durationSec: 30,
};

const CLIP: Clip = {
  id: "c1",
  assetId: "a1",
  trackId: "t1",
  start: 2,
  duration: 6,
  inPoint: 0,
  outPoint: 6,
};

const PX_PER_SEC = 50;

function renderClip(overrides: Partial<Clip> = {}) {
  const onSelect = vi.fn();
  const onMove = vi.fn();
  const onTrim = vi.fn();
  const { container } = render(
    <ClipBlock
      clip={{ ...CLIP, ...overrides }}
      asset={ASSET}
      trackId="t1"
      pxPerSec={PX_PER_SEC}
      isSelected={false}
      onSelect={onSelect}
      onMove={onMove}
      onTrim={onTrim}
    />,
  );
  const block = container.querySelector(".clip-block") as HTMLElement;
  return { block, container, onSelect, onMove, onTrim };
}

function drag(target: HTMLElement, block: HTMLElement, fromX: number, toX: number) {
  fireEvent.pointerDown(target, { clientX: fromX, pointerId: 1 });
  fireEvent.pointerMove(block, { clientX: toX, pointerId: 1 });
  fireEvent.pointerUp(block, { clientX: toX, pointerId: 1 });
}

describe("ClipBlock", () => {
  it("positions and sizes itself from the clip's timing", () => {
    const { block } = renderClip();
    expect(block.style.left).toBe(`${2 * PX_PER_SEC}px`);
    expect(block.style.width).toBe(`${6 * PX_PER_SEC}px`);
  });

  it("reports a move in seconds, not pixels", () => {
    const { block, onMove } = renderClip();
    drag(block, block, 100, 100 + 2 * PX_PER_SEC);
    expect(onMove).toHaveBeenCalledWith("c1", "t1", 4);
  });

  it("selects the clip when the drag begins", () => {
    const { block, onSelect } = renderClip();
    fireEvent.pointerDown(block, { clientX: 0, pointerId: 1 });
    expect(onSelect).toHaveBeenCalledWith("c1");
  });

  it("trims instead of moving when the drag starts on a handle", () => {
    const { block, container, onMove, onTrim } = renderClip();
    const handle = container.querySelector(".clip-block__handle--end") as HTMLElement;

    drag(handle, block, 0, PX_PER_SEC);

    expect(onTrim).toHaveBeenCalledWith("c1", "end", 1);
    expect(onMove).not.toHaveBeenCalled();
  });

  it("trims the start from the leading handle", () => {
    const { block, container, onTrim } = renderClip();
    const handle = container.querySelector(".clip-block__handle--start") as HTMLElement;

    drag(handle, block, 0, PX_PER_SEC);

    expect(onTrim).toHaveBeenCalledWith("c1", "start", 1);
  });

  it("does not report a move for a plain click", () => {
    const { block, onMove, onSelect } = renderClip();
    fireEvent.pointerDown(block, { clientX: 40, pointerId: 1 });
    fireEvent.pointerUp(block, { clientX: 40, pointerId: 1 });

    expect(onSelect).toHaveBeenCalledWith("c1");
    expect(onMove).not.toHaveBeenCalled();
  });

  it("leaves a short clip fully grabbable instead of covering it in trim handles", () => {
    // At 0.4s and 50px/s the block is 20px wide; two 8px handles would leave 4px of
    // clip to actually grab.
    const { container } = renderClip({ duration: 0.4 });
    expect(container.querySelectorAll(".clip-block__handle")).toHaveLength(0);
  });

  it("shows both handles once the clip is wide enough to spare the room", () => {
    const { container } = renderClip({ duration: 6 });
    expect(container.querySelectorAll(".clip-block__handle")).toHaveLength(2);
  });

  it("shows the asset name and the clip length", () => {
    renderClip();
    expect(screen.getByText("clip.mp4")).toBeTruthy();
    expect(screen.getByText("00:06:00")).toBeTruthy();
  });
});
