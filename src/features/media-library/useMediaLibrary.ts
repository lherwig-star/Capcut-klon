import { useCallback, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import type { MediaAsset } from "../../shared/types";
import { probeMediaFile } from "./mediaProbe";

const FILE_FILTERS = [
  { name: "Video", extensions: ["mp4", "mov", "mkv", "webm", "avi", "m4v"] },
  { name: "Audio", extensions: ["mp3", "wav", "aac", "flac", "ogg", "m4a"] },
  { name: "Bild", extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp"] },
];

export function useMediaLibrary() {
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const importFiles = useCallback(async () => {
    setError(null);
    const selection = await open({
      multiple: true,
      title: "Medien importieren",
      filters: FILE_FILTERS,
    });
    if (!selection) return;

    const paths = Array.isArray(selection) ? selection : [selection];
    setImporting(true);
    try {
      const probed = await Promise.all(
        paths.map(async (path) => {
          try {
            return await probeMediaFile(path);
          } catch (err) {
            console.error(err);
            return null;
          }
        }),
      );
      const valid = probed.filter((asset): asset is MediaAsset => asset !== null);
      if (valid.length < paths.length) {
        setError("Manche Dateien konnten nicht importiert werden (Format nicht unterstützt oder Datei defekt).");
      }
      setAssets((prev) => [...prev, ...valid]);
    } finally {
      setImporting(false);
    }
  }, []);

  const removeAsset = useCallback((id: string) => {
    setAssets((prev) => prev.filter((asset) => asset.id !== id));
  }, []);

  return { assets, importing, error, importFiles, removeAsset };
}
