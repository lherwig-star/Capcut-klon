import { useEffect, useRef, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import type { MediaAsset } from "../../shared/types";
import { getAssetDurationBound, getDefaultClipDuration } from "../../shared/mediaUtils";
import { formatTimecode } from "../../shared/time";
import type { UseTimelineReturn } from "./useTimeline";
import { Ruler } from "./Ruler";
import { TrackRow } from "./TrackRow";
import "./Timeline.css";

interface TimelineProps {
  assets: MediaAsset[];
  timelineApi: UseTimelineReturn;
}

const MIN_WIDTH_SEC = 30;
const TRAIL_SEC = 15;
/**
 * Width of the sticky track-name column. The playhead is positioned against it in script
 * while the columns themselves are laid out in CSS, so it is published as a custom
 * property below rather than written down in both places — a silent drift between the two
 * would put the playhead somewhere other than the time it points at.
 */
const HEADER_WIDTH_PX = 140;

export function Timeline({ assets, timelineApi }: TimelineProps) {
  const {
    timeline,
    durationSec,
    addTrack,
    addClip,
    moveClip,
    trimClip,
    splitClipAtPlayhead,
    removeClip,
    selectClip,
    setPlayhead,
    setZoom,
    toggleTrackMute,
    toggleTrackHidden,
  } = timelineApi;

  const rulerRef = useRef<HTMLDivElement>(null);
  const isScrubbingRef = useRef(false);
  const widthPx = Math.max(MIN_WIDTH_SEC, durationSec + TRAIL_SEC) * timeline.zoomPxPerSec;

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA"].includes(target.tagName)) return;
      if (!timeline.selectedClipId) return;
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        removeClip(timeline.selectedClipId);
      } else if (event.key.toLowerCase() === "s") {
        event.preventDefault();
        splitClipAtPlayhead(timeline.selectedClipId, timeline.playheadSec);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [timeline.selectedClipId, timeline.playheadSec, removeClip, splitClipAtPlayhead]);

  function handleDropAsset(trackId: string, assetId: string, startSec: number) {
    const asset = assets.find((a) => a.id === assetId);
    if (!asset) return;
    const duration = getDefaultClipDuration(asset);
    addClip(trackId, assetId, startSec, duration, 0, duration);
  }

  function seekFromClientX(clientX: number) {
    const rulerEl = rulerRef.current;
    if (!rulerEl) return;
    const rect = rulerEl.getBoundingClientRect();
    setPlayhead(Math.max(0, (clientX - rect.left) / timeline.zoomPxPerSec));
  }

  function handleRulerPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    // Capture on the ruler, so a scrub that wanders off it keeps tracking the pointer.
    event.currentTarget.setPointerCapture(event.pointerId);
    isScrubbingRef.current = true;
    seekFromClientX(event.clientX);
  }

  function handleRulerPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (isScrubbingRef.current) seekFromClientX(event.clientX);
  }

  function handleRulerPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    isScrubbingRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  /** Clicking past the clips moves the playhead there and clears the selection. */
  function handleLaneSeek(sec: number) {
    setPlayhead(sec);
    selectClip(null);
  }

  function handleTrim(clipId: string, edge: "start" | "end", deltaSec: number) {
    const clip = timeline.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId);
    const asset = clip ? assets.find((a) => a.id === clip.assetId) : undefined;
    if (!clip || !asset) return;
    trimClip(clipId, edge, deltaSec, getAssetDurationBound(asset));
  }

  const selectedClip = timeline.tracks.flatMap((t) => t.clips).find((c) => c.id === timeline.selectedClipId) ?? null;
  const playheadLeft = HEADER_WIDTH_PX + timeline.playheadSec * timeline.zoomPxPerSec;

  return (
    <section
      className="timeline"
      style={{ "--timeline-header-width": `${HEADER_WIDTH_PX}px` } as CSSProperties}
    >
      <header className="timeline__toolbar">
        <div className="timeline__toolbar-group">
          <button type="button" onClick={() => addTrack("video")}>
            + Video-Spur
          </button>
          <button type="button" onClick={() => addTrack("audio")}>
            + Audio-Spur
          </button>
        </div>
        <div className="timeline__toolbar-group">
          <button
            type="button"
            disabled={!selectedClip}
            onClick={() => selectedClip && splitClipAtPlayhead(selectedClip.id, timeline.playheadSec)}
          >
            ✂ Trennen
          </button>
          <button type="button" disabled={!selectedClip} onClick={() => selectedClip && removeClip(selectedClip.id)}>
            🗑 Löschen
          </button>
        </div>
        <div className="timeline__toolbar-group">
          <span className="timeline__timecode">
            {formatTimecode(timeline.playheadSec)} / {formatTimecode(durationSec)}
          </span>
          <label className="timeline__zoom">
            🔍
            <input
              type="range"
              min={10}
              max={300}
              value={timeline.zoomPxPerSec}
              onChange={(event) => setZoom(Number(event.target.value))}
            />
          </label>
        </div>
      </header>

      <div className="timeline__scroll">
        <div className="timeline__content">
          <div className="timeline__ruler-row">
            <div className="timeline__ruler-spacer" />
            <div
              className="timeline__ruler-wrap"
              ref={rulerRef}
              onPointerDown={handleRulerPointerDown}
              onPointerMove={handleRulerPointerMove}
              onPointerUp={handleRulerPointerUp}
              onPointerCancel={handleRulerPointerUp}
            >
              <Ruler widthPx={widthPx} pxPerSec={timeline.zoomPxPerSec} durationSec={durationSec} />
            </div>
          </div>

          <div className="timeline__tracks">
            {timeline.tracks.map((track) => (
              <TrackRow
                key={track.id}
                track={track}
                assets={assets}
                pxPerSec={timeline.zoomPxPerSec}
                widthPx={widthPx}
                selectedClipId={timeline.selectedClipId}
                onSelectClip={selectClip}
                onMoveClip={moveClip}
                onTrimClip={handleTrim}
                onDropAsset={handleDropAsset}
                onSeek={handleLaneSeek}
                onToggleMute={toggleTrackMute}
                onToggleHidden={toggleTrackHidden}
              />
            ))}
          </div>

          <div className="timeline__playhead" style={{ left: playheadLeft }} />
        </div>
      </div>
    </section>
  );
}
