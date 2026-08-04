export interface WordTiming {
  startMs: number;
  endMs: number;
  text: string;
}

export interface TranscriptSegment {
  startMs: number;
  endMs: number;
  text: string;
  words: WordTiming[];
}

export type SubtitleStyleId = "classic" | "box" | "word-highlight";

export interface SubtitleStyleOption {
  id: SubtitleStyleId;
  label: string;
  description: string;
}

export const SUBTITLE_STYLES: SubtitleStyleOption[] = [
  { id: "classic", label: "Klassisch", description: "Fett, weiß, mit Rand" },
  { id: "box", label: "Box", description: "Schwarzer Text auf goldenem Balken" },
  { id: "word-highlight", label: "Wort-Highlight", description: "Aktuell gesprochenes Wort leuchtet auf" },
];

export interface SubtitleLine extends TranscriptSegment {
  font: string;
  fontSize: number;
  style: SubtitleStyleId;
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

export const DEFAULT_SUBTITLE_STYLE: SubtitleStyleId = "classic";
