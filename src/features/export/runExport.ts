import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface ExportProgressPayload {
  secondsDone: number;
  totalSeconds: number;
}

export async function checkFfmpegAvailable(): Promise<boolean> {
  return invoke<boolean>("check_ffmpeg_available");
}

/**
 * A still frame from the video as a base64 JPEG data URL, produced by ffmpeg.
 *
 * Not done by drawing the <video> onto a canvas in the browser: in the packaged app the
 * page and the asset protocol are different origins, which taints the canvas and makes
 * toDataURL throw SecurityError. Returns null when ffmpeg is unavailable or the file
 * cannot be read - callers fall back to the generic icon.
 */
export async function videoThumbnail(path: string, atSeconds: number): Promise<string | null> {
  try {
    return await invoke<string | null>("video_thumbnail", { path, atSeconds });
  } catch {
    return null;
  }
}

/**
 * A fresh path in the OS temp directory, for exports that need a destination without
 * asking the user to pick one - e.g. handing the current timeline off to another part of
 * the app. Each call returns a distinct path.
 */
export async function getTempExportPath(extension: string): Promise<string> {
  return invoke<string>("temp_export_path", { extension });
}

/**
 * Asks ffprobe which of the given files carry audio. On failure everything counts as
 * silent: an export without sound beats one that aborts on a dangling audio pad.
 */
export async function probeAudioStreams(paths: string[]): Promise<boolean[]> {
  if (paths.length === 0) return [];
  try {
    return await invoke<boolean[]>("probe_audio_streams", { paths });
  } catch {
    return paths.map(() => false);
  }
}

/** Runs the export in Rust/ffmpeg, streaming progress via the "export://progress" event. */
export async function runExport(
  args: string[],
  totalSeconds: number,
  onProgress: (payload: ExportProgressPayload) => void,
): Promise<void> {
  const unlisten: UnlistenFn = await listen<ExportProgressPayload>("export://progress", (event) => {
    onProgress(event.payload);
  });

  try {
    await invoke("export_video", { args, totalSeconds });
  } finally {
    unlisten();
  }
}
