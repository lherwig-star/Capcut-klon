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
  { id: "box", label: "Box", description: "Schwarzer Text in schwerer Schrift auf farbigem Balken" },
  { id: "word-highlight", label: "Wort-Highlight", description: "Aktuell gesprochenes Wort leuchtet auf" },
];

export interface SubtitleLine extends TranscriptSegment {
  font: string;
  fontSize: number;
  style: SubtitleStyleId;
  /** Hex-Farbe: Textfarbe bei Klassisch, Box-Hintergrund bzw. hervorgehobenes Wort sonst. */
  accentColor: string;
  /** Vertikale Position als Bruchteil der Bildhöhe von oben (0 = oben, 1 = unten). */
  positionY: number;
}

// Erste Auswahl gängiger, auf macOS/Windows vorinstallierter Fonts.
// TODO: echte System-Font-Liste einlesen statt fest zu verdrahten.
// Hinweis: Der Box-Stil bildet Arial/Helvetica intern auf "Arial Black" ab — ein reines
// Bold wirkt dort neben den Social-Video-Vorlagen zu dünn (siehe heavy_font_for in Rust).
export const AVAILABLE_FONTS = [
  "Arial",
  "Arial Black",
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

// Deckt sich mit default_position_y() in src-tauri/src/subtitles.rs (28% Abstand vom
// unteren Rand) — per Drag in der Vorschau änderbar.
export const DEFAULT_POSITION_Y = 0.72;

// Kräftiges Gelb — genutzt für Box-Hintergrund und Wort-Highlight, im UI änderbar.
export const DEFAULT_ACCENT_COLOR = "#FFD400";

// Feste Auswahl statt freiem Farbwähler: native OS-Farbpaletten (macOS Color Panel etc.)
// wenden teils Farbprofil-Konvertierungen an, sodass die gewählte Farbe nicht exakt der
// gerenderten entspricht. Mit festen Hex-Werten ist die Farbe im Video immer exakt die
// hier angezeigte.
export const ACCENT_COLOR_PALETTE = [
  "#FFFFFF",
  "#000000",
  "#8E8E93",
  "#FFD400",
  "#FFCC00",
  "#FF9500",
  "#FF3B30",
  "#FF2D55",
  "#FF6B6B",
  "#AF52DE",
  "#5E5CE6",
  "#007AFF",
  "#0A84FF",
  "#30D5C8",
  "#00C7BE",
  "#34C759",
  "#4CD964",
  "#C7C7CC",
  "#FFEB3B",
  "#D4AF37",
] as const;
