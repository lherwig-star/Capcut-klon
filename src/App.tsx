import { useState } from "react";
import { MediaLibraryPanel } from "./features/media-library/MediaLibraryPanel";
import { useMediaLibrary } from "./features/media-library/useMediaLibrary";
import { PreviewPanel } from "./features/preview-engine/PreviewPanel";
import { Timeline } from "./features/timeline/Timeline";
import { useTimeline } from "./features/timeline/useTimeline";
import { ExportPanel } from "./features/export/ExportPanel";
import "./App.css";

function App() {
  const media = useMediaLibrary();
  const timelineApi = useTimeline();
  const [isExportOpen, setExportOpen] = useState(false);

  return (
    <div className="app">
      <header className="app__header">
        <span className="app__title">CapCut-Klon</span>
        <button type="button" onClick={() => setExportOpen(true)} disabled={timelineApi.durationSec <= 0}>
          Exportieren
        </button>
      </header>

      <div className="app__main">
        <aside className="app__sidebar">
          <MediaLibraryPanel
            assets={media.assets}
            importing={media.importing}
            error={media.error}
            onImport={media.importFiles}
            onRemove={media.removeAsset}
          />
        </aside>
        <div className="app__preview">
          <PreviewPanel
            timeline={timelineApi.timeline}
            assets={media.assets}
            durationSec={timelineApi.durationSec}
            setPlayhead={timelineApi.setPlayhead}
          />
        </div>
      </div>

      <div className="app__timeline">
        <Timeline assets={media.assets} timelineApi={timelineApi} />
      </div>

      {isExportOpen && (
        <ExportPanel
          timeline={timelineApi.timeline}
          assets={media.assets}
          durationSec={timelineApi.durationSec}
          onClose={() => setExportOpen(false)}
        />
      )}
    </div>
  );
}

export default App;
