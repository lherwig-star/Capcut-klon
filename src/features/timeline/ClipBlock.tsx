import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { Clip, MediaAsset } from "../../shared/types";
import { formatTimecode } from "../../shared/time";
import "./ClipBlock.css";

type DragKind = "move" | "trim-start" | "trim-end";

interface ClipBlockProps {
  clip: Clip;
  asset: MediaAsset | undefined;
  trackId: string;
  pxPerSec: number;
  isSelected: boolean;
  onSelect: (clipId: string) => void;
  onMove: (clipId: string, trackId: string, newStart: number) => void;
  onTrim: (clipId: string, edge: "start" | "end", deltaSec: number) => void;
}

export function ClipBlock({ clip, asset, trackId, pxPerSec, isSelected, onSelect, onMove, onTrim }: ClipBlockProps) {
  const dragStartX = useRef(0);
  const [dragKind, setDragKind] = useState<DragKind | null>(null);
  const [previewDeltaPx, setPreviewDeltaPx] = useState(0);

  function beginDrag(event: ReactPointerEvent<HTMLDivElement>, kind: DragKind) {
    event.stopPropagation();
    onSelect(clip.id);
    (event.target as Element).setPointerCapture(event.pointerId);
    dragStartX.current = event.clientX;
    setDragKind(kind);
    setPreviewDeltaPx(0);
  }

  function handleMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!dragKind) return;
    setPreviewDeltaPx(event.clientX - dragStartX.current);
  }

  function commit(event: ReactPointerEvent<HTMLDivElement>) {
    if (!dragKind) return;
    const deltaSec = (event.clientX - dragStartX.current) / pxPerSec;
    if (dragKind === "move") {
      onMove(clip.id, trackId, clip.start + deltaSec);
    } else if (dragKind === "trim-start") {
      onTrim(clip.id, "start", deltaSec);
    } else {
      onTrim(clip.id, "end", deltaSec);
    }
    setDragKind(null);
    setPreviewDeltaPx(0);
  }

  let left = clip.start * pxPerSec;
  let width = Math.max(6, clip.duration * pxPerSec);
  if (dragKind === "move") left += previewDeltaPx;
  if (dragKind === "trim-start") {
    left += previewDeltaPx;
    width -= previewDeltaPx;
  }
  if (dragKind === "trim-end") {
    width += previewDeltaPx;
  }
  width = Math.max(6, width);

  return (
    <div
      className={`clip-block clip-block--${asset?.kind ?? "video"} ${isSelected ? "clip-block--selected" : ""}`}
      style={{ left, width }}
      onPointerDown={(event) => beginDrag(event, "move")}
      onPointerMove={handleMove}
      onPointerUp={commit}
      onPointerCancel={commit}
      title={asset?.name}
    >
      <div className="clip-block__handle clip-block__handle--start" onPointerDown={(event) => beginDrag(event, "trim-start")} />
      <div className="clip-block__body">
        {asset?.thumbnailUrl && <img className="clip-block__thumb" src={asset.thumbnailUrl} alt="" draggable={false} />}
        <span className="clip-block__label">{asset?.name ?? "Clip"}</span>
        <span className="clip-block__duration">{formatTimecode(clip.duration)}</span>
      </div>
      <div className="clip-block__handle clip-block__handle--end" onPointerDown={(event) => beginDrag(event, "trim-end")} />
    </div>
  );
}
