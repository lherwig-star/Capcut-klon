import { useState } from "react";
import { MediaLibraryPanel } from "./features/media-library/MediaLibraryPanel";
import { useMediaLibrary } from "./features/media-library/useMediaLibrary";
import { PreviewPanel } from "./features/preview-engine/PreviewPanel";
import { Timeline } from "./features/timeline/Timeline";
import { useTimeline } from "./features/timeline/useTimeline";
import { ExportPanel } from "./features/export/ExportPanel";
import { SubtitleEditor } from "./features/subtitles/SubtitleEditor";
import "./App.css";

type View = "editor" | "subtitles";

function App() {
  const media = useMediaLibrary();
  const timelineApi = useTimeline();
  const [isExportOpen, setExportOpen] = useState(false);
  const [view, setView] = useState<View>("editor");

  return (
    <div className="app">
      <header className="app__header">
        <span className="app__title">CapCut-Klon</span>
        <nav className="app__nav">
          <button
            type="button"
            className={view === "editor" ? "is-active" : ""}
            onClick={() => setView("editor")}
          >
            Editor
          </button>
          <button
            type="button"
            className={view === "subtitles" ? "is-active" : ""}
            onClick={() => setView("subtitles")}
          >
            Untertitel
          </button>
        </nav>
        {view === "editor" && (
          <button type="button" onClick={() => setExportOpen(true)} disabled={timelineApi.durationSec <= 0}>
            Exportieren
          </button>
        )}
      </header>

      {view === "editor" ? (
        <>
          <div className="app__main">
            <aside className="app__sidebar">
              <MediaLibraryPanel
                assets={media.assets}
                importing={media.importing}
                progress={media.progress}
                errors={media.errors}
                onImport={media.importFiles}
                onRemove={media.removeAsset}
                onDismissErrors={media.dismissErrors}
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
        </>
      ) : (
        <div className="app__subtitles">
          <SubtitleEditor />
        </div>
      )}
    </div>
  );
}

export default App;
