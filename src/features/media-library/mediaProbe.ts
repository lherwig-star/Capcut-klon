import { convertFileSrc } from "@tauri-apps/api/core";
import { createId } from "../../shared/id";
import type { MediaAsset, MediaKind } from "../../shared/types";

const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "mkv", "webm", "avi", "m4v"]);
const AUDIO_EXTENSIONS = new Set(["mp3", "wav", "aac", "flac", "ogg", "m4a"]);
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp"]);

export function detectMediaKind(path: string): MediaKind | null {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  if (AUDIO_EXTENSIONS.has(ext)) return "audio";
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  return null;
}

function fileNameFromPath(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

interface VideoProbeResult {
  duration: number;
  width: number;
  height: number;
  thumbnailUrl: string;
}

function probeVideo(url: string): Promise<VideoProbeResult> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    video.src = url;

    video.onloadedmetadata = () => {
      video.currentTime = Math.min(0.5, video.duration / 2 || 0);
    };

    video.onseeked = () => {
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      ctx?.drawImage(video, 0, 0, canvas.width, canvas.height);
      resolve({
        duration: video.duration,
        width: video.videoWidth,
        height: video.videoHeight,
        thumbnailUrl: canvas.toDataURL("image/jpeg", 0.7),
      });
      video.remove();
    };

    video.onerror = () => reject(new Error(`Video konnte nicht gelesen werden: ${url}`));
  });
}

function probeAudio(url: string): Promise<{ duration: number }> {
  return new Promise((resolve, reject) => {
    const audio = document.createElement("audio");
    audio.preload = "metadata";
    audio.src = url;
    audio.onloadedmetadata = () => resolve({ duration: audio.duration });
    audio.onerror = () => reject(new Error(`Audio konnte nicht gelesen werden: ${url}`));
  });
}

function probeImage(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error(`Bild konnte nicht gelesen werden: ${url}`));
    img.src = url;
  });
}

/** Reads a locally selected file's metadata + a thumbnail, without touching the filesystem from Rust. */
export async function probeMediaFile(path: string): Promise<MediaAsset | null> {
  const kind = detectMediaKind(path);
  if (!kind) return null;

  const url = convertFileSrc(path);
  const name = fileNameFromPath(path);
  const id = createId("asset");

  if (kind === "video") {
    const { duration, width, height, thumbnailUrl } = await probeVideo(url);
    return { id, kind, name, path, url, durationSec: duration, width, height, thumbnailUrl };
  }

  if (kind === "audio") {
    const { duration } = await probeAudio(url);
    return { id, kind, name, path, url, durationSec: duration };
  }

  const { width, height } = await probeImage(url);
  return { id, kind, name, path, url, durationSec: 0, width, height, thumbnailUrl: url };
}
