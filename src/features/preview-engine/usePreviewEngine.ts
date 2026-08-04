import { useCallback, useEffect, useRef, useState } from "react";
import { clamp } from "../../shared/time";
import type { MediaAsset, TimelineState } from "../../shared/types";
import { drawContain, findActiveClip } from "./compositor";

/**
 * Drives the canvas preview: keeps a pool of hidden <video>/<img> elements per asset,
 * composites the active clip on every video track for the current playhead position,
 * and runs the play/pause loop. Audio playback is intentionally out of scope here -
 * it's owned by features/audio-editor once track mixing exists.
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
  const playheadRef = useRef(timeline.playheadSec);
  const lastFrameTimeRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    playheadRef.current = timeline.playheadSec;
  }, [timeline.playheadSec]);

  useEffect(() => {
    const validIds = new Set(assets.map((asset) => asset.id));
    for (const [id, el] of videoPool.current) {
      if (!validIds.has(id)) {
        el.pause();
        el.removeAttribute("src");
        videoPool.current.delete(id);
      }
    }
    for (const id of imagePool.current.keys()) {
      if (!validIds.has(id)) imagePool.current.delete(id);
    }
  }, [assets]);

  function getVideoElement(asset: MediaAsset): HTMLVideoElement {
    let el = videoPool.current.get(asset.id);
    if (!el) {
      el = document.createElement("video");
      el.src = asset.url;
      el.muted = true;
      el.playsInline = true;
      el.preload = "auto";
      videoPool.current.set(asset.id, el);
    }
    return el;
  }

  function getImageElement(asset: MediaAsset): HTMLImageElement {
    let el = imagePool.current.get(asset.id);
    if (!el) {
      el = new Image();
      el.src = asset.url;
      imagePool.current.set(asset.id, el);
    }
    return el;
  }

  const renderFrame = useCallback(
    (atSec: number) => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;

      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      for (const track of timeline.tracks) {
        if (track.kind !== "video" || track.hidden) continue;
        const clip = findActiveClip(timeline, track.id, atSec);
        if (!clip) continue;
        const asset = assets.find((a) => a.id === clip.assetId);
        if (!asset) continue;
        const localTime = atSec - clip.start + clip.inPoint;

        if (asset.kind === "video") {
          const videoEl = getVideoElement(asset);
          if (Math.abs(videoEl.currentTime - localTime) > 0.08) {
            videoEl.currentTime = clamp(localTime, 0, Math.max(0, asset.durationSec - 0.05));
          }
          drawContain(ctx, videoEl, videoEl.videoWidth, videoEl.videoHeight, canvas.width, canvas.height);
        } else if (asset.kind === "image") {
          const imgEl = getImageElement(asset);
          drawContain(ctx, imgEl, imgEl.naturalWidth, imgEl.naturalHeight, canvas.width, canvas.height);
        }
      }
    },
    [timeline, assets],
  );

  useEffect(() => {
    if (!isPlaying) return;
    let cancelled = false;

    function tick(now: number) {
      if (cancelled) return;
      if (lastFrameTimeRef.current == null) lastFrameTimeRef.current = now;
      const deltaSec = (now - lastFrameTimeRef.current) / 1000;
      lastFrameTimeRef.current = now;

      const next = playheadRef.current + deltaSec;
      if (next >= durationSec) {
        playheadRef.current = durationSec;
        setPlayhead(durationSec);
        renderFrame(durationSec);
        setIsPlaying(false);
        return;
      }

      playheadRef.current = next;
      setPlayhead(next);
      renderFrame(next);
      rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      lastFrameTimeRef.current = null;
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [isPlaying, durationSec, setPlayhead, renderFrame]);

  useEffect(() => {
    if (!isPlaying) renderFrame(timeline.playheadSec);
  }, [timeline.playheadSec, isPlaying, renderFrame]);

  const togglePlay = useCallback(() => {
    setIsPlaying((prev) => {
      if (!prev && playheadRef.current >= durationSec) {
        playheadRef.current = 0;
        setPlayhead(0);
      }
      return !prev;
    });
  }, [durationSec, setPlayhead]);

  const seek = useCallback(
    (sec: number) => {
      const clamped = clamp(sec, 0, durationSec);
      playheadRef.current = clamped;
      setPlayhead(clamped);
    },
    [durationSec, setPlayhead],
  );

  return { canvasRef, isPlaying, togglePlay, seek };
}
