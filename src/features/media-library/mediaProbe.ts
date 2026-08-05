import { convertFileSrc } from "@tauri-apps/api/core";
import { createId } from "../../shared/id";
import type { MediaAsset, MediaKind } from "../../shared/types";

const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "mkv", "webm", "avi", "m4v"]);
const AUDIO_EXTENSIONS = new Set(["mp3", "wav", "aac", "flac", "ogg", "m4a"]);
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp"]);

/** Metadata has to arrive within this window, otherwise the file counts as unreadable. */
const METADATA_TIMEOUT_MS = 15_000;
/**
 * Thumbnails are best-effort: if the seek stalls, probeVideo falls back to whatever frame
 * is already decoded rather than leaving the asset without one. Generous on purpose - the
 * first read of a real file through Tauri's asset protocol (disk I/O, antivirus scanning)
 * can be slower than a synthetic test clip ever is.
 */
const THUMBNAIL_TIMEOUT_MS = 6_000;

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

/**
 * Rejects if `promise` has not settled in `ms`. Every probe goes through this: a media element
 * that never fires a load/error event would otherwise leave the import spinner stuck forever.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        window.clearTimeout(timer);
        reject(err);
      },
    );
  });
}

// Spelled out rather than read off the global MediaError: this runs inside an error
// handler, and a ReferenceError thrown there would leave the import promise pending
// forever — the very hang this module exists to avoid. The values are fixed by spec.
const MEDIA_ERR_ABORTED = 1;
const MEDIA_ERR_NETWORK = 2;
const MEDIA_ERR_DECODE = 3;
const MEDIA_ERR_SRC_NOT_SUPPORTED = 4;

function mediaErrorMessage(el: HTMLMediaElement, name: string): string {
  switch (el.error?.code) {
    case MEDIA_ERR_ABORTED:
      return `${name}: Laden wurde abgebrochen.`;
    case MEDIA_ERR_NETWORK:
      return `${name}: Datei konnte nicht gelesen werden (Zugriff verweigert?).`;
    case MEDIA_ERR_DECODE:
      return `${name}: Datei ist beschädigt oder unvollständig.`;
    case MEDIA_ERR_SRC_NOT_SUPPORTED:
      return `${name}: Codec/Container wird vom System-Player nicht unterstützt.`;
    default:
      return `${name}: Datei konnte nicht geladen werden.`;
  }
}

interface VideoMetadata {
  duration: number;
  width: number;
  height: number;
}

function loadVideoMetadata(video: HTMLVideoElement, name: string): Promise<VideoMetadata> {
  return new Promise<VideoMetadata>((resolve, reject) => {
    video.onloadedmetadata = () =>
      resolve({
        // Some containers (e.g. streamed mkv/webm) report Infinity - treat it as unknown.
        duration: Number.isFinite(video.duration) ? video.duration : 0,
        width: video.videoWidth,
        height: video.videoHeight,
      });
    video.onerror = () => reject(new Error(mediaErrorMessage(video, name)));
  });
}

/**
 * Draws whatever frame the element currently has decoded. `undefined` if there is none yet -
 * critically, this checks readyState and not just videoWidth/videoHeight: dimensions are
 * already known at HAVE_METADATA, well before a frame exists to draw. Skipping that check
 * would risk capturing a guaranteed-black canvas and reporting it as a successful thumbnail,
 * silently reproducing the exact bug this function exists to avoid.
 */
function grabVideoFrame(video: HTMLVideoElement): string | undefined {
  if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return undefined;
  if (!video.videoWidth || !video.videoHeight) return undefined;
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) return undefined;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  try {
    return canvas.toDataURL("image/jpeg", 0.7);
  } catch {
    return undefined;
  }
}

/**
 * Grabs a still frame near the middle of the clip. Resolves with `undefined` rather than
 * rejecting, because a missing thumbnail must never keep an otherwise valid file out of the
 * library. Note that seeking to the position the element already sits at fires no `seeked`
 * event, so the target is nudged off zero and the timeout in the caller covers whatever the
 * WebView decides not to report.
 */
function captureThumbnail(video: HTMLVideoElement): Promise<string | undefined> {
  return new Promise<string | undefined>((resolve) => {
    const target =
      Number.isFinite(video.duration) && video.duration > 0 ? Math.min(0.5, video.duration / 2) : 0;

    if (target <= 0 || Math.abs(video.currentTime - target) < 0.001) {
      // No seek would happen - draw whatever frame is decoded once data is available.
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) resolve(grabVideoFrame(video));
      else video.onloadeddata = () => resolve(grabVideoFrame(video));
      return;
    }

    video.onseeked = () => resolve(grabVideoFrame(video));
    video.onerror = () => resolve(undefined);
    video.currentTime = target;
  });
}

function releaseMediaElement(el: HTMLMediaElement) {
  el.onloadedmetadata = null;
  el.onloadeddata = null;
  el.onseeked = null;
  el.onerror = null;
  el.removeAttribute("src");
  el.load();
}

async function probeVideo(url: string, name: string) {
  const video = document.createElement("video");
  video.preload = "auto";
  video.muted = true;
  video.playsInline = true;
  video.src = url;

  try {
    const meta = await withTimeout(
      loadVideoMetadata(video, name),
      METADATA_TIMEOUT_MS,
      `${name}: Zeitüberschreitung beim Lesen der Metadaten.`,
    );
    const thumbnailUrl = await withTimeout(
      captureThumbnail(video),
      THUMBNAIL_TIMEOUT_MS,
      "thumbnail-timeout",
    ).catch(() => {
      // The seek to the target frame never finished - most likely a slow first disk read
      // through the asset protocol, not a decode failure. Whatever the decoder already
      // has on screen (typically the first frame) beats falling back to the generic icon.
      return grabVideoFrame(video);
    });
    return { ...meta, thumbnailUrl };
  } finally {
    releaseMediaElement(video);
  }
}

async function probeAudio(url: string, name: string) {
  const audio = document.createElement("audio");
  audio.preload = "metadata";
  audio.src = url;

  try {
    return await withTimeout(
      new Promise<{ duration: number }>((resolve, reject) => {
        audio.onloadedmetadata = () =>
          resolve({ duration: Number.isFinite(audio.duration) ? audio.duration : 0 });
        audio.onerror = () => reject(new Error(mediaErrorMessage(audio, name)));
      }),
      METADATA_TIMEOUT_MS,
      `${name}: Zeitüberschreitung beim Lesen der Metadaten.`,
    );
  } finally {
    releaseMediaElement(audio);
  }
}

function probeImage(url: string, name: string): Promise<{ width: number; height: number }> {
  return withTimeout(
    new Promise<{ width: number; height: number }>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => reject(new Error(`${name}: Bild konnte nicht geladen werden.`));
      img.src = url;
    }),
    METADATA_TIMEOUT_MS,
    `${name}: Zeitüberschreitung beim Laden des Bildes.`,
  );
}

/** Reads a locally selected file's metadata + a thumbnail, without touching the filesystem from Rust. */
export async function probeMediaFile(path: string): Promise<MediaAsset> {
  const kind = detectMediaKind(path);
  const name = fileNameFromPath(path);
  if (!kind) {
    throw new Error(`${name}: Dateiformat wird nicht unterstützt.`);
  }

  const url = convertFileSrc(path);
  const id = createId("asset");

  if (kind === "video") {
    const { duration, width, height, thumbnailUrl } = await probeVideo(url, name);
    return { id, kind, name, path, url, durationSec: duration, width, height, thumbnailUrl };
  }

  if (kind === "audio") {
    const { duration } = await probeAudio(url, name);
    return { id, kind, name, path, url, durationSec: duration };
  }

  const { width, height } = await probeImage(url, name);
  return { id, kind, name, path, url, durationSec: 0, width, height, thumbnailUrl: url };
}
