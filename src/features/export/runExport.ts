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
