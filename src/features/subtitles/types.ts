export interface TranscriptSegment {
  startMs: number;
  endMs: number;
  text: string;
}

export interface SubtitleLine extends TranscriptSegment {
  font: string;
  fontSize: number;
}

// Erste Auswahl gängiger, auf macOS/Windows vorinstallierter Fonts.
// TODO: echte System-Font-Liste einlesen statt fest zu verdrahten.
export const AVAILABLE_FONTS = [
  "Arial",
  "Helvetica",
  "Impact",
  "Times New Roman",
  "Courier New",
  "Georgia",
] as const;

// Referenzgröße bei 1920px Videohöhe (Rust skaliert das proportional auf die
// tatsächliche Videoauflösung) — 64 ergibt gut lesbare, TikTok-artige Untertitel.
export const DEFAULT_FONT_SIZE = 64;
