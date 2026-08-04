import type { DragEvent } from "react";
import type { MediaAsset } from "../../shared/types";
import { formatTimecode } from "../../shared/time";
import { MEDIA_ASSET_DRAG_TYPE } from "../../shared/dragTypes";
import "./MediaLibraryPanel.css";

interface MediaLibraryPanelProps {
  assets: MediaAsset[];
  importing: boolean;
  error: string | null;
  onImport: () => void;
  onRemove: (id: string) => void;
}

const KIND_ICON: Record<MediaAsset["kind"], string> = {
  video: "\u{1F3AC}",
  audio: "\u{1F3B5}",
  image: "\u{1F5BC}",
};

export function MediaLibraryPanel({ assets, importing, error, onImport, onRemove }: MediaLibraryPanelProps) {
  function handleDragStart(event: DragEvent<HTMLDivElement>, asset: MediaAsset) {
    event.dataTransfer.setData(MEDIA_ASSET_DRAG_TYPE, asset.id);
    event.dataTransfer.effectAllowed = "copy";
  }

  return (
    <section className="media-library">
      <header className="media-library__header">
        <h2>Medien</h2>
        <button type="button" onClick={onImport} disabled={importing}>
          {importing ? "Importiere…" : "+ Importieren"}
        </button>
      </header>

      {error && <p className="media-library__error">{error}</p>}

      {assets.length === 0 ? (
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
              title={asset.path}
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
    </section>
  );
}
