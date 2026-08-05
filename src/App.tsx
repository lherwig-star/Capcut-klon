import { useState } from "react";
import { MediaLibraryPanel } from "./features/media-library/MediaLibraryPanel";
import { useMediaLibrary } from "./features/media-library/useMediaLibrary";
import { PreviewPanel } from "./features/preview-engine/PreviewPanel";
import { Timeline } from "./features/timeline/Timeline";
import { useTimeline } from "./features/timeline/useTimeline";
import { ExportPanel } from "./features/export/ExportPanel";
import { exportTimeline } from "./features/export/exportTimeline";
import { getTempExportPath } from "./features/export/runExport";
import { SubtitleEditor } from "./features/subtitles/SubtitleEditor";
import "./App.css";

type View = "editor" | "subtitles";

/** Good enough to transcribe and to preview while editing subtitles; a full-quality
 *  export is still available separately via "Exportieren". Keeping the handoff render
 *  small keeps the wait between the two tools short. */
const HANDOFF_WIDTH = 1280;
const HANDOFF_HEIGHT = 720;
const HANDOFF_FPS = 30;

function App() {
  const media = useMediaLibrary();
  const timelineApi = useTimeline();
  const [isExportOpen, setExportOpen] = useState(false);
  const [view, setView] = useState<View>("editor");
  const [subtitleVideoPath, setSubtitleVideoPath] = useState<string | null>(null);
  const [isHandoffBusy, setHandoffBusy] = useState(false);
  const [handoffProgress, setHandoffProgress] = useState(0);
  const [handoffError, setHandoffError] = useState<string | null>(null);

  async function handleSendToSubtitles() {
    setHandoffError(null);
    setHandoffBusy(true);
    setHandoffProgress(0);
    try {
      const outputPath = await getTempExportPath("mp4");
      await exportTimeline(
        timelineApi.timeline,
        media.assets,
        { outputPath, width: HANDOFF_WIDTH, height: HANDOFF_HEIGHT, fps: HANDOFF_FPS },
        (payload) => {
          setHandoffProgress(payload.totalSeconds > 0 ? Math.min(1, payload.secondsDone / payload.totalSeconds) : 0);
        },
      );
      setSubtitleVideoPath(outputPath);
      setView("subtitles");
    } catch (err) {
      setHandoffError(String(err));
    } finally {
      setHandoffBusy(false);
    }
  }

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
          <div className="app__header-actions">
            {handoffError && <span className="app__handoff-error">{handoffError}</span>}
            <button
              type="button"
              onClick={handleSendToSubtitles}
              disabled={isHandoffBusy || timelineApi.durationSec <= 0}
            >
              {isHandoffBusy ? `Wird übergeben… ${Math.round(handoffProgress * 100)}%` : "Für Untertitel verwenden"}
            </button>
            <button type="button" onClick={() => setExportOpen(true)} disabled={timelineApi.durationSec <= 0}>
              Exportieren
            </button>
          </div>
        )}
      </header>

      {/* Der Übergang rendert das ganze Video und dauert entsprechend. Ein Prozentwert im
          Knopf oben rechts ist dafür zu unauffällig - ohne sichtbaren Fortschritt wirkt die
          App schlicht hängengeblieben. */}
      {isHandoffBusy && (
        <div className="app__handoff-overlay">
          <div className="app__handoff-card">
            <h2>Video wird an die Untertitel übergeben</h2>
            <p>Die Timeline wird gerendert. Das dauert je nach Länge des Videos etwas.</p>
            <div className="app__handoff-track">
              <div className="app__handoff-bar" style={{ width: `${Math.round(handoffProgress * 100)}%` }} />
            </div>
            <span className="app__handoff-percent">{Math.round(handoffProgress * 100)} %</span>
          </div>
        </div>
      )}

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
                onAddToTimeline={timelineApi.appendAsset}
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
          <SubtitleEditor initialVideoPath={subtitleVideoPath} />
        </div>
      )}
    </div>
  );
}

export default App;
