import { useMemo, useReducer } from "react";
import type { MediaAsset, TrackKind } from "../../shared/types";
import { getDefaultClipDuration } from "../../shared/mediaUtils";
import { createInitialTimeline, getTimelineDuration, timelineReducer } from "./timelineReducer";

export function useTimeline() {
  const [timeline, dispatch] = useReducer(timelineReducer, undefined, createInitialTimeline);
  const durationSec = useMemo(() => getTimelineDuration(timeline), [timeline]);

  /** Appends an asset behind the last clip of the first matching track - the drag-free way in. */
  function appendAsset(asset: MediaAsset) {
    const kind: TrackKind = asset.kind === "audio" ? "audio" : "video";
    const track = timeline.tracks.find((t) => t.kind === kind);
    if (!track) return;
    const start = track.clips.reduce((end, clip) => Math.max(end, clip.start + clip.duration), 0);
    const duration = getDefaultClipDuration(asset);
    dispatch({ type: "add-clip", trackId: track.id, assetId: asset.id, start, duration, inPoint: 0, outPoint: duration });
  }

  return {
    timeline,
    durationSec,
    appendAsset,
    addTrack: (kind: TrackKind) => dispatch({ type: "add-track", kind }),
    addClip: (trackId: string, assetId: string, start: number, duration: number, inPoint: number, outPoint: number) =>
      dispatch({ type: "add-clip", trackId, assetId, start, duration, inPoint, outPoint }),
    moveClip: (clipId: string, trackId: string, start: number) =>
      dispatch({ type: "move-clip", clipId, trackId, start }),
    trimClip: (clipId: string, edge: "start" | "end", deltaSec: number, assetDurationSec: number) =>
      dispatch({ type: "trim-clip", clipId, edge, deltaSec, assetDurationSec }),
    splitClipAtPlayhead: (clipId: string, atSec: number) => dispatch({ type: "split-clip", clipId, atSec }),
    removeClip: (clipId: string) => dispatch({ type: "remove-clip", clipId }),
    selectClip: (clipId: string | null) => dispatch({ type: "select-clip", clipId }),
    setPlayhead: (sec: number) => dispatch({ type: "set-playhead", sec }),
    setZoom: (pxPerSec: number) => dispatch({ type: "set-zoom", pxPerSec }),
    toggleTrackMute: (trackId: string) => dispatch({ type: "toggle-track-mute", trackId }),
    toggleTrackHidden: (trackId: string) => dispatch({ type: "toggle-track-hidden", trackId }),
  };
}

export type UseTimelineReturn = ReturnType<typeof useTimeline>;
