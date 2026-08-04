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

export const DEFAULT_FONT_SIZE = 28;
