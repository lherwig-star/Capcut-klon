import { createId } from "../../shared/id";
import { clamp } from "../../shared/time";
import type { Clip, TimelineState, Track, TrackKind } from "../../shared/types";

export type TimelineAction =
  | { type: "add-track"; kind: TrackKind }
  | {
      type: "add-clip";
      trackId: string;
      assetId: string;
      start: number;
      duration: number;
      inPoint: number;
      outPoint: number;
    }
  | { type: "move-clip"; clipId: string; trackId: string; start: number }
  | { type: "trim-clip"; clipId: string; edge: "start" | "end"; deltaSec: number; assetDurationSec: number }
  | { type: "split-clip"; clipId: string; atSec: number }
  | { type: "remove-clip"; clipId: string }
  | { type: "select-clip"; clipId: string | null }
  | { type: "set-playhead"; sec: number }
  | { type: "set-zoom"; pxPerSec: number }
  | { type: "toggle-track-mute"; trackId: string }
  | { type: "toggle-track-hidden"; trackId: string };

export function createInitialTimeline(): TimelineState {
  return {
    tracks: [
      { id: createId("track"), kind: "video", name: "Video 1", clips: [], muted: false, hidden: false },
      { id: createId("track"), kind: "audio", name: "Audio 1", clips: [], muted: false, hidden: false },
    ],
    playheadSec: 0,
    zoomPxPerSec: 60,
    selectedClipId: null,
  };
}

export function getTimelineDuration(state: TimelineState): number {
  let max = 0;
  for (const track of state.tracks) {
    for (const clip of track.clips) {
      max = Math.max(max, clip.start + clip.duration);
    }
  }
  return max;
}

function clipsOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd - 1e-6 && bStart < aEnd - 1e-6;
}

function hasCollision(track: Track, candidate: Clip): boolean {
  return track.clips.some(
    (clip) =>
      clip.id !== candidate.id &&
      clipsOverlap(candidate.start, candidate.start + candidate.duration, clip.start, clip.start + clip.duration),
  );
}

function findClip(state: TimelineState, clipId: string): { track: Track; clip: Clip } | null {
  for (const track of state.tracks) {
    const clip = track.clips.find((c) => c.id === clipId);
    if (clip) return { track, clip };
  }
  return null;
}

function replaceClipInTrack(state: TimelineState, trackId: string, candidate: Clip): TimelineState {
  return {
    ...state,
    tracks: state.tracks.map((track) =>
      track.id === trackId
        ? {
            ...track,
            clips: track.clips
              .map((clip) => (clip.id === candidate.id ? candidate : clip))
              .sort((a, b) => a.start - b.start),
          }
        : track,
    ),
  };
}

export function timelineReducer(state: TimelineState, action: TimelineAction): TimelineState {
  switch (action.type) {
    case "add-track": {
      const label = action.kind === "video" ? "Video" : "Audio";
      const count = state.tracks.filter((track) => track.kind === action.kind).length + 1;
      const track: Track = {
        id: createId("track"),
        kind: action.kind,
        name: `${label} ${count}`,
        clips: [],
        muted: false,
        hidden: false,
      };
      return { ...state, tracks: [...state.tracks, track] };
    }

    case "add-clip": {
      const clip: Clip = {
        id: createId("clip"),
        assetId: action.assetId,
        trackId: action.trackId,
        start: Math.max(0, action.start),
        duration: Math.max(0.05, action.duration),
        inPoint: action.inPoint,
        outPoint: action.outPoint,
      };
      let placed = false;
      const tracks = state.tracks.map((track) => {
        if (track.id !== action.trackId) return track;
        if (hasCollision(track, clip)) return track;
        placed = true;
        return { ...track, clips: [...track.clips, clip].sort((a, b) => a.start - b.start) };
      });
      if (!placed) return state;
      return { ...state, tracks, selectedClipId: clip.id };
    }

    case "move-clip": {
      const found = findClip(state, action.clipId);
      const targetTrack = state.tracks.find((track) => track.id === action.trackId);
      if (!found || !targetTrack || targetTrack.kind !== found.track.kind) return state;

      const candidate: Clip = { ...found.clip, trackId: action.trackId, start: Math.max(0, action.start) };
      const siblings =
        targetTrack.id === found.track.id
          ? targetTrack.clips.filter((c) => c.id !== candidate.id)
          : targetTrack.clips;
      const collides = siblings.some((c) =>
        clipsOverlap(candidate.start, candidate.start + candidate.duration, c.start, c.start + c.duration),
      );
      if (collides) return state;

      return {
        ...state,
        tracks: state.tracks.map((track) => {
          if (track.id === found.track.id && track.id === targetTrack.id) {
            return {
              ...track,
              clips: track.clips.map((c) => (c.id === candidate.id ? candidate : c)).sort((a, b) => a.start - b.start),
            };
          }
          if (track.id === found.track.id) {
            return { ...track, clips: track.clips.filter((c) => c.id !== candidate.id) };
          }
          if (track.id === targetTrack.id) {
            return { ...track, clips: [...track.clips, candidate].sort((a, b) => a.start - b.start) };
          }
          return track;
        }),
      };
    }

    case "trim-clip": {
      const found = findClip(state, action.clipId);
      if (!found) return state;
      const { clip, track } = found;

      if (action.edge === "start") {
        const maxDelta = clip.duration - 0.1;
        const minDelta = -clip.inPoint;
        const delta = clamp(action.deltaSec, minDelta, maxDelta);
        if (Math.abs(delta) < 1e-6) return state;
        const candidate: Clip = {
          ...clip,
          start: clip.start + delta,
          duration: clip.duration - delta,
          inPoint: clip.inPoint + delta,
        };
        if (candidate.start < 0 || hasCollision(track, candidate)) return state;
        return replaceClipInTrack(state, track.id, candidate);
      }

      const maxDelta = action.assetDurationSec - clip.outPoint;
      const minDelta = -(clip.duration - 0.1);
      const delta = clamp(action.deltaSec, minDelta, maxDelta);
      if (Math.abs(delta) < 1e-6) return state;
      const candidate: Clip = { ...clip, duration: clip.duration + delta, outPoint: clip.outPoint + delta };
      if (hasCollision(track, candidate)) return state;
      return replaceClipInTrack(state, track.id, candidate);
    }

    case "split-clip": {
      const found = findClip(state, action.clipId);
      if (!found) return state;
      const { clip, track } = found;
      const localOffset = action.atSec - clip.start;
      if (localOffset <= 0.05 || localOffset >= clip.duration - 0.05) return state;

      const first: Clip = { ...clip, duration: localOffset, outPoint: clip.inPoint + localOffset };
      const second: Clip = {
        ...clip,
        id: createId("clip"),
        start: clip.start + localOffset,
        duration: clip.duration - localOffset,
        inPoint: clip.inPoint + localOffset,
      };

      return {
        ...state,
        tracks: state.tracks.map((t) =>
          t.id === track.id
            ? {
                ...t,
                clips: t.clips
                  .flatMap((c) => (c.id === clip.id ? [first, second] : [c]))
                  .sort((a, b) => a.start - b.start),
              }
            : t,
        ),
        selectedClipId: second.id,
      };
    }

    case "remove-clip": {
      return {
        ...state,
        tracks: state.tracks.map((track) => ({
          ...track,
          clips: track.clips.filter((clip) => clip.id !== action.clipId),
        })),
        selectedClipId: state.selectedClipId === action.clipId ? null : state.selectedClipId,
      };
    }

    case "select-clip":
      return { ...state, selectedClipId: action.clipId };

    case "set-playhead":
      return { ...state, playheadSec: Math.max(0, action.sec) };

    case "set-zoom":
      return { ...state, zoomPxPerSec: clamp(action.pxPerSec, 10, 400) };

    case "toggle-track-mute":
      return {
        ...state,
        tracks: state.tracks.map((track) =>
          track.id === action.trackId ? { ...track, muted: !track.muted } : track,
        ),
      };

    case "toggle-track-hidden":
      return {
        ...state,
        tracks: state.tracks.map((track) =>
          track.id === action.trackId ? { ...track, hidden: !track.hidden } : track,
        ),
      };

    default:
      return state;
  }
}
