import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { message, open, save } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  AVAILABLE_FONTS,
  DEFAULT_ACCENT_COLOR,
  DEFAULT_FONT_SIZE,
  DEFAULT_SUBTITLE_STYLE,
  SUBTITLE_STYLES,
  SubtitleLine,
  SubtitleStyleId,
  TranscriptSegment,
} from "./types";
import "./SubtitleEditor.css";

function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function suggestedOutputPath(videoPath: string): string {
  const match = videoPath.match(/^(.*)(\.[^./\\]+)$/);
  if (!match) return `${videoPath}_untertitelt`;
  return `${match[1]}_untertitelt${match[2]}`;
}

interface SubtitleEditorProps {
  /**
   * A video handed in from elsewhere in the app (currently: the video editor's "an
   * Untertitel übergeben" handoff), so it opens here already loaded instead of making
   * the user pick the just-exported file by hand. Every value change loads it, including
   * a repeated handoff of a freshly re-rendered cut - the caller is expected to hand in a
   * fresh path each time (e.g. a temp file with a new name) rather than mutating one in
   * place, since an unchanged value here intentionally does nothing.
   */
  initialVideoPath?: string | null;
}

export function SubtitleEditor({ initialVideoPath = null }: SubtitleEditorProps = {}) {
  const [videoPath, setVideoPath] = useState<string | null>(null);
  const [lines, setLines] = useState<SubtitleLine[]>([]);
  const [defaultFont, setDefaultFont] = useState<string>(AVAILABLE_FONTS[0]);
  const [defaultStyle, setDefaultStyle] = useState<SubtitleStyleId>(DEFAULT_SUBTITLE_STYLE);
  const [defaultAccentColor, setDefaultAccentColor] = useState<string>(DEFAULT_ACCENT_COLOR);
  const [status, setStatus] = useState<string>("");
  const [busy, setBusy] = useState(false);

  // Adjusts state during render rather than in an effect (React's documented pattern for
  // resetting state from a changed prop): applying the handoff in an effect would commit
  // a wasted render with the stale video first. appliedHandoffPath is what stops this from
  // looping - without it every render would see initialVideoPath "changed" again.
  const [appliedHandoffPath, setAppliedHandoffPath] = useState<string | null>(null);
  if (initialVideoPath && initialVideoPath !== appliedHandoffPath) {
    setAppliedHandoffPath(initialVideoPath);
    setVideoPath(initialVideoPath);
    setLines([]);
    setStatus("Video aus dem Editor übernommen.");
  }

  async function pickVideo() {
    const selected = await open({
      multiple: false,
      filters: [{ name: "Video", extensions: ["mp4", "mov", "mkv", "avi", "m4v"] }],
    });
    if (typeof selected === "string") {
      setVideoPath(selected);
      setLines([]);
      setStatus("");
    }
  }

  async function transcribe() {
    if (!videoPath) return;
    setBusy(true);
    setStatus("Transkribiere Audio lokal (whisper.cpp) …");
    try {
      const segments = await invoke<TranscriptSegment[]>("transcribe_video", {
        videoPath,
        modelPath: null,
        language: "de",
      });
      setLines(
        segments.map((s) => ({
          ...s,
          font: defaultFont,
          fontSize: DEFAULT_FONT_SIZE,
          style: defaultStyle,
          accentColor: defaultAccentColor,
        })),
      );
      setStatus(`${segments.length} Segmente transkribiert.`);
    } catch (e) {
      const msg = `Fehler bei der Transkription: ${e}`;
      setStatus(msg);
      await message(msg, { title: "Transkription fehlgeschlagen", kind: "error" });
    } finally {
      setBusy(false);
    }
  }

  function updateLine(index: number, patch: Partial<SubtitleLine>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  function applyFontToAll(font: string) {
    setDefaultFont(font);
    setLines((prev) => prev.map((l) => ({ ...l, font })));
  }

  function applyStyleToAll(style: SubtitleStyleId) {
    setDefaultStyle(style);
    setLines((prev) => prev.map((l) => ({ ...l, style })));
  }

  function applyAccentColorToAll(color: string) {
    setDefaultAccentColor(color);
    setLines((prev) => prev.map((l) => ({ ...l, accentColor: color })));
  }

  async function renderVideo() {
    if (!videoPath || lines.length === 0) return;
    try {
      const output = await save({
        defaultPath: suggestedOutputPath(videoPath),
        filters: [{ name: "Video", extensions: ["mp4"] }],
      });
      if (!output) return;

      setBusy(true);
      setStatus("Brenne Untertitel ins Video …");

      const outputPath = await invoke<string>("render_subtitled_video", {
        videoPath,
        lines,
        outputPath: output,
      });
      setStatus(`Fertig: ${outputPath}`);
      await message(`Video gespeichert unter:\n${outputPath}`, {
        title: "Rendern abgeschlossen",
        kind: "info",
      });
      await revealItemInDir(outputPath);
    } catch (e) {
      const msg = `Fehler beim Rendern: ${e}`;
      setStatus(msg);
      await message(msg, { title: "Rendern fehlgeschlagen", kind: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="subtitle-editor">
      <h1>Untertitel</h1>

      <div className="row">
        <button onClick={pickVideo} disabled={busy}>
          Video auswählen
        </button>
        {videoPath && <span className="path">{videoPath}</span>}
      </div>

      <div className="row">
        <button className="btn-primary" onClick={transcribe} disabled={!videoPath || busy}>
          Transkribieren
        </button>
        <label>
          Standard-Font{" "}
          <select value={defaultFont} onChange={(e) => applyFontToAll(e.target.value)}>
            {AVAILABLE_FONTS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
        <label>
          Stil{" "}
          <select
            value={defaultStyle}
            onChange={(e) => applyStyleToAll(e.target.value as SubtitleStyleId)}
            title={SUBTITLE_STYLES.find((s) => s.id === defaultStyle)?.description}
          >
            {SUBTITLE_STYLES.map((s) => (
              <option key={s.id} value={s.id} title={s.description}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="color-field">
          Farbe{" "}
          <input
            type="color"
            value={defaultAccentColor}
            onChange={(e) => applyAccentColorToAll(e.target.value)}
            title="Farbe für Box-Hintergrund bzw. Wort-Highlight"
          />
        </label>
      </div>

      {status && <p className="status">{status}</p>}

      {lines.length > 0 && (
        <>
          <ul className="segments">
            {lines.map((line, i) => (
              <li key={i} className="segment">
                <span className="time">
                  {formatTime(line.startMs)}–{formatTime(line.endMs)}
                </span>
                <textarea
                  value={line.text}
                  onChange={(e) => updateLine(i, { text: e.target.value })}
                  rows={2}
                />
                <div className="segment__selects">
                  <select
                    value={line.font}
                    onChange={(e) => updateLine(i, { font: e.target.value })}
                  >
                    {AVAILABLE_FONTS.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>
                  <select
                    value={line.style}
                    onChange={(e) => updateLine(i, { style: e.target.value as SubtitleStyleId })}
                    title={SUBTITLE_STYLES.find((s) => s.id === line.style)?.description}
                  >
                    {SUBTITLE_STYLES.map((s) => (
                      <option key={s.id} value={s.id} title={s.description}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                  <input
                    type="color"
                    className="segment__color"
                    value={line.accentColor}
                    onChange={(e) => updateLine(i, { accentColor: e.target.value })}
                    title="Farbe für Box-Hintergrund bzw. Wort-Highlight"
                  />
                </div>
              </li>
            ))}
          </ul>

          <button className="btn-primary btn-block" onClick={renderVideo} disabled={busy}>
            Video mit Untertiteln rendern
          </button>
        </>
      )}
    </div>
  );
}
