import { useCallback, useEffect, useRef, useState } from "react";
import { clamp } from "../../shared/time";
import type { MediaAsset, TimelineState } from "../../shared/types";
import { drawContain, findActiveClip } from "./compositor";

/**
 * Drift the playing element is allowed before it gets re-seeked. Generous on purpose:
 * a seek per frame stalls decoding, and this doubles as the fallback when the WebView
 * refuses `play()` — the element then falls behind until a seek pulls it forward again,
 * which degrades to a choppy preview instead of a frozen one.
 */
const PLAYBACK_DRIFT_TOLERANCE_SEC = 0.3;
/** While paused, a seek shorter than this is not worth issuing. */
const SCRUB_SEEK_EPSILON_SEC = 0.04;

/**
 * Drives the canvas preview: keeps a pool of hidden <video>/<img> elements per asset,
 * composites the active clip of every video track for the current playhead, and runs
 * the play/pause loop.
 *
 * Playback lets the video elements run themselves and only corrects them when they
 * drift. Seeking them frame by frame instead — the obvious reading of "draw the frame
 * at time t" — never settles, because a seek is asynchronous and the next one arrives
 * before the last has finished.
 */
export function usePreviewEngine(
  timeline: TimelineState,
  assets: MediaAsset[],
  durationSec: number,
  setPlayhead: (sec: number) => void,
) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoPool = useRef<Map<string, HTMLVideoElement>>(new Map());
  const imagePool = useRef<Map<string, HTMLImageElement>>(new Map());

  // The render loop reads everything through refs. Were it to close over props
  // directly, every playhead update would change its identity, restart the loop and
  // reset the frame clock — leaving the playhead stuck where it started.
  const timelineRef = useRef(timeline);
  const assetsRef = useRef(assets);
  const durationRef = useRef(durationSec);
  const setPlayheadRef = useRef(setPlayhead);
  const playheadRef = useRef(timeline.playheadSec);
  const isPlayingRef = useRef(false);
  const drawFrameRef = useRef<(atSec: number) => void>(() => {});

  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    timelineRef.current = timeline;
    playheadRef.current = timeline.playheadSec;
  }, [timeline]);
  useEffect(() => {
    assetsRef.current = assets;
  }, [assets]);
  useEffect(() => {
    durationRef.current = durationSec;
  }, [durationSec]);
  useEffect(() => {
    setPlayheadRef.current = setPlayhead;
  }, [setPlayhead]);
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  const getVideoElement = useCallback((asset: MediaAsset): HTMLVideoElement => {
    const existing = videoPool.current.get(asset.id);
    if (existing) return existing;

    const el = document.createElement("video");
    el.src = asset.url;
    el.preload = "auto";
    el.playsInline = true;
    // Loading and seeking both finish asynchronously. Without redrawing once they do,
    // a paused preview keeps showing whatever was on the canvas before — and for a
    // freshly created element that is nothing at all, since it has no decoded frame yet.
    const redraw = () => {
      if (!isPlayingRef.current) drawFrameRef.current(playheadRef.current);
    };
    el.addEventListener("loadeddata", redraw);
    el.addEventListener("seeked", redraw);
    videoPool.current.set(asset.id, el);
    return el;
  }, []);

  const getImageElement = useCallback((asset: MediaAsset): HTMLImageElement => {
    const existing = imagePool.current.get(asset.id);
    if (existing) return existing;

    const el = new Image();
    el.addEventListener("load", () => {
      if (!isPlayingRef.current) drawFrameRef.current(playheadRef.current);
    });
    el.src = asset.url;
    imagePool.current.set(asset.id, el);
    return el;
  }, []);

  const drawFrame = useCallback(
    (atSec: number) => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;

      const currentTimeline = timelineRef.current;
      const currentAssets = assetsRef.current;
      const playing = isPlayingRef.current;

      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const onScreen = new Set<string>();

      for (const track of currentTimeline.tracks) {
        if (track.kind !== "video") continue;
        const clip = findActiveClip(currentTimeline, track.id, atSec);
        if (!clip) continue;
        const asset = currentAssets.find((a) => a.id === clip.assetId);
        if (!asset) continue;
        const localTime = atSec - clip.start + clip.inPoint;

        if (asset.kind === "video") {
          onScreen.add(asset.id);
          const el = getVideoElement(asset);
          el.muted = track.muted;
          // asset.durationSec is 0 for a video whose real length could not be determined
          // (some streamed/live-recorded containers report Infinity, normalised to 0 in
          // mediaProbe.ts). Math.max(0, 0 - 0.05) would then clamp every target to zero,
          // freezing that clip on its first frame for its entire run - during playback
          // and while scrubbing alike, since both branches read this same target. Only
          // clamp against the upper bound when there is a known one to clamp against.
          const target =
            asset.durationSec > 0
              ? clamp(localTime, 0, Math.max(0, asset.durationSec - 0.05))
              : Math.max(0, localTime);

          if (playing) {
            if (Math.abs(el.currentTime - target) > PLAYBACK_DRIFT_TOLERANCE_SEC) {
              el.currentTime = target;
            }
            if (el.paused) void el.play().catch(() => undefined);
          } else {
            if (!el.paused) el.pause();
            if (Math.abs(el.currentTime - target) > SCRUB_SEEK_EPSILON_SEC) {
              el.currentTime = target;
            }
          }

          if (!track.hidden) {
            drawContain(ctx, el, el.videoWidth, el.videoHeight, canvas.width, canvas.height);
          }
        } else if (asset.kind === "image" && !track.hidden) {
          const img = getImageElement(asset);
          drawContain(ctx, img, img.naturalWidth, img.naturalHeight, canvas.width, canvas.height);
        }
      }

      // A clip the playhead has left keeps running — and keeps being audible — unless
      // it is stopped explicitly.
      for (const [assetId, el] of videoPool.current) {
        if (!onScreen.has(assetId) && !el.paused) el.pause();
      }
    },
    [getVideoElement, getImageElement],
  );

  useEffect(() => {
    drawFrameRef.current = drawFrame;
  }, [drawFrame]);

  // Only isPlaying flips this on and off; drawFrame's identity is stable, so the loop
  // survives the playhead updates it causes.
  useEffect(() => {
    if (!isPlaying) return;

    let raf = 0;
    let cancelled = false;
    let lastFrameTime = performance.now();

    function tick(now: number) {
      if (cancelled) return;
      const deltaSec = (now - lastFrameTime) / 1000;
      lastFrameTime = now;

      const total = durationRef.current;
      const next = playheadRef.current + deltaSec;

      if (total <= 0 || next >= total) {
        playheadRef.current = total;
        setPlayheadRef.current(total);
        drawFrame(total);
        setIsPlaying(false);
        return;
      }

      playheadRef.current = next;
      setPlayheadRef.current(next);
      drawFrame(next);
      raf = requestAnimationFrame(tick);
    }

    raf = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [isPlaying, drawFrame]);

  // Redraws while paused: scrubbing, but also trimming or moving a clip.
  useEffect(() => {
    if (!isPlaying) drawFrame(timeline.playheadSec);
  }, [timeline, isPlaying, drawFrame]);

  // Starts loading every video referenced anywhere on the timeline, not just the clip
  // currently under the playhead. Without this, a <video> element for a clip is created
  // by drawFrame only once the playhead reaches it - for a clip whose asset was never
  // touched before, that's the very moment playback needs a decoded frame from it, and
  // the seconds it can take to buffer enough data show up as a black flash mid-playback.
  // Warming every clip up front means it has had as long as possible to buffer by the
  // time the playhead actually gets there.
  useEffect(() => {
    for (const track of timeline.tracks) {
      if (track.kind !== "video") continue;
      for (const clip of track.clips) {
        const asset = assets.find((a) => a.id === clip.assetId);
        if (asset?.kind === "video") getVideoElement(asset);
      }
    }
  }, [timeline, assets, getVideoElement]);

  // Assets removed from the library must not stay loaded — or audible.
  useEffect(() => {
    const validIds = new Set(assets.map((asset) => asset.id));
    for (const [id, el] of videoPool.current) {
      if (validIds.has(id)) continue;
      el.pause();
      el.removeAttribute("src");
      el.load();
      videoPool.current.delete(id);
    }
    for (const id of imagePool.current.keys()) {
      if (!validIds.has(id)) imagePool.current.delete(id);
    }
  }, [assets]);

  useEffect(() => {
    const pool = videoPool.current;
    return () => {
      for (const el of pool.values()) {
        el.pause();
        el.removeAttribute("src");
        el.load();
      }
      pool.clear();
    };
  }, []);

  const togglePlay = useCallback(() => {
    const total = durationRef.current;
    if (total <= 0) return;

    if (isPlayingRef.current) {
      setIsPlaying(false);
      return;
    }
    if (playheadRef.current >= total - 1e-3) {
      playheadRef.current = 0;
      setPlayheadRef.current(0);
    }
    setIsPlaying(true);
  }, []);

  const seek = useCallback((sec: number) => {
    const clamped = clamp(sec, 0, durationRef.current);
    playheadRef.current = clamped;
    setPlayheadRef.current(clamped);
  }, []);

  return { canvasRef, isPlaying, togglePlay, seek };
}
