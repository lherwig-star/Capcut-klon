import type { MediaAsset, TimelineState } from "../../shared/types";
import { formatTimecode } from "../../shared/time";
import { usePreviewEngine } from "./usePreviewEngine";
import "./PreviewPanel.css";

interface PreviewPanelProps {
  timeline: TimelineState;
  assets: MediaAsset[];
  durationSec: number;
  setPlayhead: (sec: number) => void;
}

const CANVAS_WIDTH = 1280;
const CANVAS_HEIGHT = 720;

export function PreviewPanel({ timeline, assets, durationSec, setPlayhead }: PreviewPanelProps) {
  const { canvasRef, isPlaying, togglePlay, seek } = usePreviewEngine(timeline, assets, durationSec, setPlayhead);

  return (
    <section className="preview-panel">
      <div className="preview-panel__stage">
        <canvas ref={canvasRef} width={CANVAS_WIDTH} height={CANVAS_HEIGHT} />
      </div>
      <div className="preview-panel__controls">
        <button type="button" onClick={() => seek(0)} title="Zum Anfang">
          ⏮
        </button>
        <button type="button" onClick={togglePlay} title={isPlaying ? "Pause" : "Abspielen"}>
          {isPlaying ? "⏸" : "▶"}
        </button>
        <button type="button" onClick={() => seek(durationSec)} title="Zum Ende">
          ⏭
        </button>
        <span className="preview-panel__timecode">
          {formatTimecode(timeline.playheadSec)} / {formatTimecode(durationSec)}
        </span>
      </div>
    </section>
  );
}
