import type { DragEvent } from "react";
import type { MediaAsset } from "../../shared/types";
import { formatTimecode } from "../../shared/time";
import { MEDIA_ASSET_DRAG_TYPE } from "../../shared/dragTypes";
import type { ImportProgress } from "./useMediaLibrary";
import "./MediaLibraryPanel.css";

interface MediaLibraryPanelProps {
  assets: MediaAsset[];
  importing: boolean;
  progress: ImportProgress | null;
  errors: string[];
  onImport: () => void;
  onRemove: (id: string) => void;
  onDismissErrors: () => void;
  onAddToTimeline: (asset: MediaAsset) => void;
}

const KIND_ICON: Record<MediaAsset["kind"], string> = {
  video: "\u{1F3AC}",
  audio: "\u{1F3B5}",
  image: "\u{1F5BC}",
};

export function MediaLibraryPanel({
  assets,
  importing,
  progress,
  errors,
  onImport,
  onRemove,
  onDismissErrors,
  onAddToTimeline,
}: MediaLibraryPanelProps) {
  function handleDragStart(event: DragEvent<HTMLDivElement>, asset: MediaAsset) {
    event.dataTransfer.setData(MEDIA_ASSET_DRAG_TYPE, asset.id);
    event.dataTransfer.effectAllowed = "copy";
  }

  const percent = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <section className="media-library">
      <header className="media-library__header">
        <h2>Medien</h2>
        <button type="button" onClick={onImport} disabled={importing}>
          {importing ? "Importiere…" : "+ Importieren"}
        </button>
      </header>

      {progress && (
        <div className="media-library__progress">
          <div className="media-library__progress-track">
            <div className="media-library__progress-bar" style={{ width: `${percent}%` }} />
          </div>
          <span className="media-library__progress-label">
            {progress.done} / {progress.total}
            {progress.currentName && ` — ${progress.currentName}`}
          </span>
        </div>
      )}

      {errors.length > 0 && (
        <div className="media-library__errors">
          <button
            type="button"
            className="media-library__errors-dismiss"
            onClick={onDismissErrors}
            aria-label="Fehler ausblenden"
          >
            ×
          </button>
          <strong>{errors.length === 1 ? "Eine Datei" : `${errors.length} Dateien`} nicht importiert:</strong>
          <ul>
            {errors.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </div>
      )}

      {assets.length === 0 && !importing ? (
        <p className="media-library__empty">
          Noch keine Medien importiert. Klicke auf „Importieren“, um Video-, Audio- oder Bilddateien
          hinzuzufügen.
        </p>
      ) : (
        <div className="media-library__grid">
          {assets.map((asset) => (
            <div
              key={asset.id}
              className="media-card"
              draggable
              onDragStart={(event) => handleDragStart(event, asset)}
              onDoubleClick={() => onAddToTimeline(asset)}
              title={`${asset.path}\n\nDoppelklick fügt den Clip ans Ende der Spur an.`}
            >
              <div className="media-card__thumb">
                {asset.thumbnailUrl ? (
                  <img src={asset.thumbnailUrl} alt="" draggable={false} />
                ) : (
                  <span className="media-card__icon">{KIND_ICON[asset.kind]}</span>
                )}
                {asset.durationSec > 0 && (
                  <span className="media-card__duration">{formatTimecode(asset.durationSec)}</span>
                )}
              </div>
              <div className="media-card__meta">
                <span className="media-card__name">{asset.name}</span>
                <button
                  type="button"
                  className="media-card__remove"
                  onClick={() => onRemove(asset.id)}
                  aria-label={`${asset.name} entfernen`}
                >
                  ×
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {assets.length > 0 && (
        <p className="media-library__hint">Auf eine Spur ziehen oder doppelklicken zum Anhängen.</p>
      )}
    </section>
  );
}
