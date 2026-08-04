import { useCallback, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import type { MediaAsset } from "../../shared/types";
import { probeMediaFile } from "./mediaProbe";

const FILE_FILTERS = [
  {
    name: "Alle Medien",
    extensions: [
      "mp4", "mov", "mkv", "webm", "avi", "m4v",
      "mp3", "wav", "aac", "flac", "ogg", "m4a",
      "png", "jpg", "jpeg", "gif", "webp", "bmp",
    ],
  },
  { name: "Video", extensions: ["mp4", "mov", "mkv", "webm", "avi", "m4v"] },
  { name: "Audio", extensions: ["mp3", "wav", "aac", "flac", "ogg", "m4a"] },
  { name: "Bild", extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp"] },
];

export interface ImportProgress {
  done: number;
  total: number;
  currentName: string;
}

export function useMediaLibrary() {
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  const importFiles = useCallback(async () => {
    setErrors([]);

    let selection: string | string[] | null;
    try {
      selection = await open({ multiple: true, title: "Medien importieren", filters: FILE_FILTERS });
    } catch (err) {
      setErrors([`Dateiauswahl fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`]);
      return;
    }
    if (!selection) return;

    const paths = Array.isArray(selection) ? selection : [selection];
    setImporting(true);
    setProgress({ done: 0, total: paths.length, currentName: "" });

    const failures: string[] = [];
    try {
      // Sequential on purpose: probing several videos at once starves the WebView's decoder
      // and makes per-file progress impossible to report.
      for (const [index, path] of paths.entries()) {
        const name = path.split(/[\\/]/).pop() ?? path;
        setProgress({ done: index, total: paths.length, currentName: name });
        try {
          const asset = await probeMediaFile(path);
          setAssets((prev) => [...prev, asset]);
        } catch (err) {
          failures.push(err instanceof Error ? err.message : String(err));
        }
      }
      setProgress({ done: paths.length, total: paths.length, currentName: "" });
    } finally {
      setImporting(false);
      setProgress(null);
      setErrors(failures);
    }
  }, []);

  const removeAsset = useCallback((id: string) => {
    setAssets((prev) => prev.filter((asset) => asset.id !== id));
  }, []);

  const dismissErrors = useCallback(() => setErrors([]), []);

  return { assets, importing, progress, errors, importFiles, removeAsset, dismissErrors };
}
