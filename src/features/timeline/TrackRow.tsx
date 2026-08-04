import { useRef, type DragEvent } from "react";
import type { MediaAsset, Track } from "../../shared/types";
import { MEDIA_ASSET_DRAG_TYPE } from "../../shared/dragTypes";
import { ClipBlock } from "./ClipBlock";
import "./TrackRow.css";

interface TrackRowProps {
  track: Track;
  assets: MediaAsset[];
  pxPerSec: number;
  widthPx: number;
  selectedClipId: string | null;
  onSelectClip: (clipId: string) => void;
  onMoveClip: (clipId: string, trackId: string, start: number) => void;
  onTrimClip: (clipId: string, edge: "start" | "end", deltaSec: number) => void;
  onDropAsset: (trackId: string, assetId: string, startSec: number) => void;
  onToggleMute: (trackId: string) => void;
  onToggleHidden: (trackId: string) => void;
}

export function TrackRow({
  track,
  assets,
  pxPerSec,
  widthPx,
  selectedClipId,
  onSelectClip,
  onMoveClip,
  onTrimClip,
  onDropAsset,
  onToggleMute,
  onToggleHidden,
}: TrackRowProps) {
  const laneRef = useRef<HTMLDivElement>(null);

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    if (event.dataTransfer.types.includes(MEDIA_ASSET_DRAG_TYPE)) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    const assetId = event.dataTransfer.getData(MEDIA_ASSET_DRAG_TYPE);
    if (!assetId || !laneRef.current) return;
    event.preventDefault();
    const rect = laneRef.current.getBoundingClientRect();
    const startSec = Math.max(0, (event.clientX - rect.left) / pxPerSec);
    onDropAsset(track.id, assetId, startSec);
  }

  return (
    <div className={`track-row track-row--${track.kind}`}>
      <div className="track-row__header">
        <span className="track-row__name">{track.name}</span>
        <div className="track-row__buttons">
          <button
            type="button"
            className={track.muted ? "is-active" : ""}
            onClick={() => onToggleMute(track.id)}
            title={track.muted ? "Stummschaltung aufheben" : "Stummschalten"}
          >
            {track.muted ? "🔇" : "🔊"}
          </button>
          {track.kind === "video" && (
            <button
              type="button"
              className={track.hidden ? "is-active" : ""}
              onClick={() => onToggleHidden(track.id)}
              title={track.hidden ? "Einblenden" : "Ausblenden"}
            >
              {track.hidden ? "🙈" : "👁"}
            </button>
          )}
        </div>
      </div>
      <div
        className="track-row__lane"
        ref={laneRef}
        style={{ width: widthPx }}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {track.clips.map((clip) => (
          <ClipBlock
            key={clip.id}
            clip={clip}
            asset={assets.find((asset) => asset.id === clip.assetId)}
            trackId={track.id}
            pxPerSec={pxPerSec}
            isSelected={selectedClipId === clip.id}
            onSelect={onSelectClip}
            onMove={onMoveClip}
            onTrim={onTrimClip}
          />
        ))}
      </div>
    </div>
  );
}
