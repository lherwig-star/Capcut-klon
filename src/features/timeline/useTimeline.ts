import { useMemo, useReducer } from "react";
import type { TrackKind } from "../../shared/types";
import { createInitialTimeline, getTimelineDuration, timelineReducer } from "./timelineReducer";

export function useTimeline() {
  const [timeline, dispatch] = useReducer(timelineReducer, undefined, createInitialTimeline);
  const durationSec = useMemo(() => getTimelineDuration(timeline), [timeline]);

  return {
    timeline,
    durationSec,
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
