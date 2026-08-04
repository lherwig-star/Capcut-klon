import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface ExportProgressPayload {
  secondsDone: number;
  totalSeconds: number;
}

export async function checkFfmpegAvailable(): Promise<boolean> {
  return invoke<boolean>("check_ffmpeg_available");
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
