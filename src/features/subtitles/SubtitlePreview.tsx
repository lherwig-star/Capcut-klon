import { useEffect, useRef } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { SubtitleStyleId } from "./types";
import "./SubtitlePreview.css";

export interface PreviewLine {
  text: string;
  font: string;
  style: SubtitleStyleId;
  accentColor: string;
}

interface SubtitlePreviewProps {
  videoPath: string;
  line: PreviewLine;
  positionY: number;
  onPositionYChange: (positionY: number) => void;
}

// Muss mit heavy_font_for() in src-tauri/src/subtitles.rs übereinstimmen, damit die
// Vorschau zeigt, was tatsächlich gerendert wird.
function heavyFontFor(font: string): string {
  return font === "Arial" || font === "Helvetica" ? "Arial Black" : font;
}

function OverlayContent({ line }: { line: PreviewLine }) {
  if (line.style === "box") {
    return (
      <span
        className="subtitle-preview__box"
        style={{ background: line.accentColor, fontFamily: heavyFontFor(line.font) }}
      >
        {line.text}
      </span>
    );
  }

  if (line.style === "word-highlight") {
    const words = line.text.split(" ").filter(Boolean);
    return (
      <span className="subtitle-preview__classic" style={{ fontFamily: line.font }}>
        {words.map((w, i) => (
          <span key={i} style={{ color: i === 0 ? line.accentColor : "#fff" }}>
            {w}
            {i < words.length - 1 ? " " : ""}
          </span>
        ))}
      </span>
    );
  }

  return (
    <span
      className="subtitle-preview__classic"
      style={{ color: line.accentColor, fontFamily: line.font }}
    >
      {line.text}
    </span>
  );
}

/**
 * Zeigt einen Frame des gewählten Videos mit den Untertiteln als CSS-Näherung
 * obendrüber. Die Position lässt sich per Drag verschieben (z.B. wenn Untertitel
 * sonst über dem Mund sitzen würden) — das Ergebnis fließt als `positionY`
 * (Bruchteil der Bildhöhe von oben) direkt ins Rendering ein.
 */
export function SubtitlePreview({ videoPath, line, positionY, onPositionYChange }: SubtitlePreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const draggingRef = useRef(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    function seekToRepresentativeFrame() {
      if (video && Number.isFinite(video.duration) && video.duration > 0) {
        video.currentTime = Math.min(0.5, video.duration / 2);
      }
    }
    video.addEventListener("loadedmetadata", seekToRepresentativeFrame);
    return () => video.removeEventListener("loadedmetadata", seekToRepresentativeFrame);
  }, [videoPath]);

  function updateFromPointer(clientY: number) {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || rect.height === 0) return;
    const fraction = (clientY - rect.top) / rect.height;
    onPositionYChange(Math.min(0.95, Math.max(0.05, fraction)));
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    draggingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    updateFromPointer(e.clientY);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!draggingRef.current) return;
    updateFromPointer(e.clientY);
  }

  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    draggingRef.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
  }

  return (
    <div className="subtitle-preview" ref={containerRef}>
      <video ref={videoRef} src={convertFileSrc(videoPath)} muted playsInline />
      <div
        className="subtitle-preview__overlay"
        style={{ top: `${positionY * 100}%` }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <OverlayContent line={line} />
      </div>
      <p className="subtitle-preview__hint">Untertitel zum Verschieben ziehen</p>
    </div>
  );
}
