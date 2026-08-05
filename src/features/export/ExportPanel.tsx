import { useEffect, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import type { MediaAsset, TimelineState } from "../../shared/types";
import { formatTimecode } from "../../shared/time";
import { buildFfmpegArgs } from "./buildFfmpegArgs";
import { checkFfmpegAvailable, probeAudioStreams, runExport } from "./runExport";
import "./ExportPanel.css";

interface ExportPanelProps {
  timeline: TimelineState;
  assets: MediaAsset[];
  durationSec: number;
  onClose: () => void;
}

type ExportStatus = "idle" | "exporting" | "done" | "error";

export function ExportPanel({ timeline, assets, durationSec, onClose }: ExportPanelProps) {
  const [width, setWidth] = useState(1280);
  const [height, setHeight] = useState(720);
  const [fps, setFps] = useState(30);
  const [status, setStatus] = useState<ExportStatus>("idle");
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [ffmpegAvailable, setFfmpegAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    checkFfmpegAvailable()
      .then(setFfmpegAvailable)
      .catch(() => setFfmpegAvailable(false));
  }, []);

  async function handleExport() {
    setMessage(null);
    const outputPath = await save({
      title: "Export speichern unter",
      defaultPath: "export.mp4",
      filters: [{ name: "MP4-Video", extensions: ["mp4"] }],
    });
    if (!outputPath) return;

    setStatus("exporting");
    setProgress(0);
    try {
      // Which sources actually have sound is only knowable via ffprobe, and the graph has
      // to know before it is built - see buildFfmpegArgs.
      const probed = await probeAudioStreams(assets.map((asset) => asset.path));
      const assetsWithAudio = assets.map((asset, index) => ({ ...asset, hasAudio: probed[index] ?? false }));
      const plan = buildFfmpegArgs(timeline, assetsWithAudio, { outputPath, width, height, fps });
      await runExport(plan.args, plan.totalSeconds, (payload) => {
        setProgress(payload.totalSeconds > 0 ? Math.min(1, payload.secondsDone / payload.totalSeconds) : 0);
      });
      setStatus("done");
      setMessage(`Export erfolgreich gespeichert unter ${outputPath}`);
    } catch (err) {
      setStatus("error");
      setMessage(String(err));
    }
  }

  return (
    <div className="export-panel__backdrop" onClick={onClose}>
      <div className="export-panel" onClick={(event) => event.stopPropagation()}>
        <header className="export-panel__header">
          <h2>Video exportieren</h2>
          <button type="button" onClick={onClose} aria-label="Schließen">
            ×
          </button>
        </header>

        {ffmpegAvailable === false && (
          <p className="export-panel__warning">
            ffmpeg wurde auf diesem System nicht gefunden. Bitte installieren und im PATH verfügbar machen.
          </p>
        )}

        <div className="export-panel__field">
          <label>Auflösung</label>
          <div className="export-panel__row">
            <input type="number" value={width} min={16} step={2} onChange={(event) => setWidth(Number(event.target.value))} />
            <span>×</span>
            <input type="number" value={height} min={16} step={2} onChange={(event) => setHeight(Number(event.target.value))} />
          </div>
        </div>

        <div className="export-panel__field">
          <label>Bildrate (fps)</label>
          <input type="number" value={fps} min={1} max={120} onChange={(event) => setFps(Number(event.target.value))} />
        </div>

        <div className="export-panel__field export-panel__field--row">
          <label>Länge</label>
          <span>{formatTimecode(durationSec)}</span>
        </div>

        {status === "exporting" && (
          <div className="export-panel__progress">
            <div className="export-panel__progress-bar" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        )}

        {message && <p className={`export-panel__message export-panel__message--${status}`}>{message}</p>}

        <footer className="export-panel__footer">
          <button
            type="button"
            className="export-panel__submit"
            onClick={handleExport}
            disabled={status === "exporting" || durationSec <= 0}
          >
            {status === "exporting" ? `Exportiere… ${Math.round(progress * 100)}%` : "Exportieren"}
          </button>
        </footer>
      </div>
    </div>
  );
}
