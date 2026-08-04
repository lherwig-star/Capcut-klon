use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WordTiming {
    pub start_ms: i64,
    pub end_ms: i64,
    pub text: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptSegment {
    pub start_ms: i64,
    pub end_ms: i64,
    pub text: String,
    pub words: Vec<WordTiming>,
}

/// Drei Untertitel-Stile zur Auswahl. `WordHighlight` braucht die Wort-Zeitstempel
/// aus `TranscriptSegment::words`, die anderen ignorieren sie.
#[derive(Debug, Deserialize, Clone, Copy, PartialEq, Eq, Hash)]
#[serde(rename_all = "kebab-case")]
pub enum SubtitleStyle {
    Classic,
    Box,
    WordHighlight,
}

fn default_accent_color() -> String {
    DEFAULT_ACCENT_COLOR_HEX.to_string()
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SubtitleLine {
    pub start_ms: i64,
    pub end_ms: i64,
    pub text: String,
    pub font: String,
    pub font_size: u32,
    pub style: SubtitleStyle,
    /// Hex-Farbe (`#RRGGBB`), genutzt für den Box-Hintergrund bzw. das hervorgehobene
    /// Wort beim Wort-Highlight-Stil. Bei `Classic` ungenutzt.
    #[serde(default = "default_accent_color")]
    pub accent_color: String,
    #[serde(default)]
    pub words: Vec<WordTiming>,
}

#[derive(Deserialize)]
struct WhisperJson {
    transcription: Vec<WhisperSegment>,
}

#[derive(Deserialize)]
struct WhisperSegment {
    offsets: WhisperOffsets,
    text: String,
}

#[derive(Deserialize)]
struct WhisperOffsets {
    from: i64,
    to: i64,
}

/// Dev-only default: Modelle liegen im Repo unter `models/`, nicht in den Build eingebettet.
/// Für Produktionsbuilds muss das Modell stattdessen ins App-Datenverzeichnis heruntergeladen werden.
pub fn default_model_path() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../models/ggml-small.bin")
}

fn run(mut cmd: Command) -> Result<String, String> {
    let output = cmd
        .output()
        .map_err(|e| format!("Befehl konnte nicht gestartet werden ({e}). Ist ffmpeg/whisper-cli installiert und im PATH?"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

fn extract_audio(video_path: &Path, out_wav: &Path) -> Result<(), String> {
    let mut cmd = Command::new("ffmpeg");
    cmd.arg("-y")
        .arg("-i")
        .arg(video_path)
        .args(["-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le"])
        .arg(out_wav);
    run(cmd)?;
    Ok(())
}

/// Parst die Ausgabe von `ffprobe -of csv=p=0:s=x stream=width,height`.
/// Manche ffprobe-Versionen hängen einen zusätzlichen Trenner ans Zeilenende
/// (z.B. "2160x3840x" statt "2160x3840") — leere Teile daher rausfiltern.
fn parse_resolution_csv(out: &str) -> Result<(u32, u32), String> {
    let mut parts = out.trim().split('x').filter(|s| !s.is_empty());
    let w: u32 = parts
        .next()
        .ok_or_else(|| "Videoauflösung konnte nicht ermittelt werden".to_string())?
        .trim()
        .parse()
        .map_err(|_| "Ungültige Breite".to_string())?;
    let h: u32 = parts
        .next()
        .ok_or_else(|| "Videoauflösung konnte nicht ermittelt werden".to_string())?
        .trim()
        .parse()
        .map_err(|_| "Ungültige Höhe".to_string())?;
    Ok((w, h))
}

pub fn get_video_resolution(video_path: &Path) -> Result<(u32, u32), String> {
    let mut cmd = Command::new("ffprobe");
    cmd.args([
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height",
        "-of",
        "csv=p=0:s=x",
    ])
    .arg(video_path);
    let out = run(cmd)?;
    parse_resolution_csv(&out)
}

const MAX_WORDS_PER_LINE: usize = 5;
const MAX_GAP_MS_WITHIN_LINE: i64 = 600;

/// Gruppiert wortgenaue Zeitstempel zu kurzen, TikTok-artigen Zeilen (max. 5 Wörter,
/// neue Zeile bei einer Sprechpause > 600ms). Die Wortliste jeder Zeile bleibt für den
/// Wort-Highlight-Stil erhalten.
fn group_words_into_lines(words: &[WordTiming]) -> Vec<TranscriptSegment> {
    let mut lines = Vec::new();
    let mut current: Vec<WordTiming> = Vec::new();

    for word in words {
        if word.text.trim().is_empty() {
            continue;
        }
        if let Some(last) = current.last() {
            let gap = word.start_ms - last.end_ms;
            if current.len() >= MAX_WORDS_PER_LINE || gap > MAX_GAP_MS_WITHIN_LINE {
                lines.push(finish_line(std::mem::take(&mut current)));
            }
        }
        current.push(WordTiming {
            start_ms: word.start_ms,
            end_ms: word.end_ms,
            text: word.text.trim().to_string(),
        });
    }
    if !current.is_empty() {
        lines.push(finish_line(current));
    }
    lines
}

fn finish_line(words: Vec<WordTiming>) -> TranscriptSegment {
    let start_ms = words.first().map(|w| w.start_ms).unwrap_or(0);
    let end_ms = words.last().map(|w| w.end_ms).unwrap_or(start_ms);
    let text = words
        .iter()
        .map(|w| w.text.as_str())
        .collect::<Vec<_>>()
        .join(" ");
    TranscriptSegment {
        start_ms,
        end_ms,
        text,
        words,
    }
}

/// Extrahiert die Audiospur aus dem Video und transkribiert sie lokal mit whisper.cpp,
/// wortgenau (`-ml 1 -sow` zwingt whisper, ein Wort pro Segment mit eigenem Zeitstempel
/// auszugeben). Die Wörter werden anschließend zu kurzen Zeilen gruppiert.
pub fn transcribe_video(
    video_path: &Path,
    model_path: &Path,
    language: &str,
) -> Result<Vec<TranscriptSegment>, String> {
    let pid = std::process::id();
    let tmp_wav = std::env::temp_dir().join(format!("capcut-audio-{pid}.wav"));

    extract_audio(video_path, &tmp_wav)?;

    let out_prefix = std::env::temp_dir().join(format!("capcut-transcript-{pid}"));
    let mut cmd = Command::new("whisper-cli");
    cmd.arg("-m")
        .arg(model_path)
        .arg("-f")
        .arg(&tmp_wav)
        .arg("-l")
        .arg(language)
        .arg("--output-json")
        .arg("-of")
        .arg(&out_prefix)
        // Ein Wort pro Segment mit eigenem Zeitstempel (Basis fürs Wort-Highlight).
        .arg("-ml")
        .arg("1")
        .arg("-sow")
        .arg("-np");
    let transcribe_result = run(cmd);

    let _ = std::fs::remove_file(&tmp_wav);

    transcribe_result?;

    let json_path = out_prefix.with_extension("json");
    let json_str = std::fs::read_to_string(&json_path)
        .map_err(|e| format!("Transkript konnte nicht gelesen werden: {e}"))?;
    let _ = std::fs::remove_file(&json_path);

    let parsed: WhisperJson = serde_json::from_str(&json_str)
        .map_err(|e| format!("Transkript-JSON ungültig: {e}"))?;

    let words: Vec<WordTiming> = parsed
        .transcription
        .into_iter()
        .map(|s| WordTiming {
            start_ms: s.offsets.from,
            end_ms: s.offsets.to,
            text: s.text,
        })
        .collect();

    Ok(group_words_into_lines(&words))
}

fn format_ass_time(ms: i64) -> String {
    let total_cs = ms.max(0) / 10;
    let h = total_cs / 360_000;
    let m = (total_cs / 6_000) % 60;
    let s = (total_cs / 100) % 60;
    let cs = total_cs % 100;
    format!("{h}:{m:02}:{s:02}.{cs:02}")
}

fn escape_ass_text(text: &str) -> String {
    text.replace('\\', "\\\\").replace('\n', "\\N")
}

fn sanitize_style_name(font: &str) -> String {
    font.chars()
        .map(|c| if c.is_alphanumeric() { c } else { '_' })
        .collect()
}

/// `line.font_size` wird als Referenzgröße bei 1920px Höhe interpretiert und linear
/// auf die tatsächliche Videohöhe skaliert — sonst wirkt derselbe Zahlenwert auf einem
/// 3840px-Hochformat-Handyvideo winzig, auf einem 360px-Testvideo riesig.
fn scale_to_video_height(reference_size: u32, play_res_y: u32) -> u32 {
    ((reference_size as f32 * play_res_y as f32 / 1920.0).round() as u32).max(1)
}

/// Default-Akzentfarbe (kräftiges Gelb), falls das Frontend keine eigene mitschickt.
const DEFAULT_ACCENT_COLOR_HEX: &str = "#FFD400";
/// Weiß als ASS-Inline-Override-Farbe, zum Zurücksetzen nach dem hervorgehobenen Wort.
const WHITE_COLOR_INLINE: &str = "&HFFFFFF&";
/// Das Wort-Highlight etwas später als whisper's Zeitstempel starten/enden lassen —
/// gefühlt kam die Hervorhebung sonst, bevor das Wort tatsächlich zu hören war.
const WORD_HIGHLIGHT_DELAY_MS: i64 = 90;

fn parse_hex_rgb(hex: &str) -> (u8, u8, u8) {
    let h = hex.trim_start_matches('#');
    if h.len() != 6 {
        return (0xFF, 0xD4, 0x00);
    }
    let r = u8::from_str_radix(&h[0..2], 16).unwrap_or(0xFF);
    let g = u8::from_str_radix(&h[2..4], 16).unwrap_or(0xD4);
    let b = u8::from_str_radix(&h[4..6], 16).unwrap_or(0x00);
    (r, g, b)
}

/// Hex-Farbe (`#RRGGBB`) als ASS-Inline-Override-Farbe (`&HBBGGRR&`), für `{\c...}`-Tags.
fn hex_to_ass_inline(hex: &str) -> String {
    let (r, g, b) = parse_hex_rgb(hex);
    format!("&H{b:02X}{g:02X}{r:02X}&")
}

/// Hex-Farbe (`#RRGGBB`) als ASS-Style-Farbfeld (`&HAABBGGRR`, hier immer opak).
fn hex_to_ass_style_color(hex: &str) -> String {
    let (r, g, b) = parse_hex_rgb(hex);
    format!("&H00{b:02X}{g:02X}{r:02X}")
}

fn style_definition(name: &str, font: &str, size: u32, margin_lr: u32, margin_v: u32) -> String {
    // Gilt für Classic und WordHighlight: fette weiße Schrift mit dickem Rand.
    let outline = (size as f32 * 0.09).round().max(2.0) as u32;
    format!(
        "Style: {name},{font},{size},&H00FFFFFF,&H000000FF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,{outline},0,2,{margin_lr},{margin_lr},{margin_v},1\n"
    )
}

/// Reiner Füll-Style für das gezeichnete Box-Rechteck (`\p`-Vektorobjekt nutzt PrimaryColour
/// als Füllfarbe). Fontname/Fontsize sind hier irrelevant, aber vom ASS-Format verlangt.
fn box_bg_style_definition(name: &str, accent_color_hex: &str) -> String {
    let fill = hex_to_ass_style_color(accent_color_hex);
    format!("Style: {name},Arial,10,{fill},&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,5,0,0,0,1\n")
}

/// Text-Style fürs Box-Layer: schwarze, fette Schrift ohne eigenen Rand (liegt auf der
/// bereits kontrastreichen Fläche).
fn box_text_style_definition(name: &str, font: &str, size: u32) -> String {
    format!("Style: {name},{font},{size},&H00000000,&H000000FF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,0,0,5,0,0,0,1\n")
}

/// Schätzt die gerenderte Breite/Höhe einer Zeile grob anhand der Zeichenanzahl, um das
/// Hintergrund-Rechteck der Box passend zu dimensionieren. Keine echte Textmetrik (die hat
/// nur libass zur Renderzeit) — Faktoren wurden gegen echtes Rendern kalibriert.
fn estimate_box_size(text: &str, size: u32) -> (f32, f32) {
    let char_count = text.chars().count().max(1) as f32;
    let size = size as f32;
    let avg_char_width = size * 0.58;
    let padding_x = size * 0.5;
    let padding_y = size * 0.28;
    let width = char_count * avg_char_width + padding_x * 2.0;
    let height = size * 1.2 + padding_y * 2.0;
    (width, height)
}

/// Zeichnet ein abgerundetes Rechteck (Breite `w`, Höhe `h`, Eckradius `r`) als ASS-`\p`-
/// Drawing-Pfad, Ursprung oben links bei (0,0). Ecken werden per Bezier angenähert.
fn rounded_rect_drawing(w: f32, h: f32, r: f32) -> String {
    let r = r.min(w / 2.0).min(h / 2.0).max(0.0);
    let wr = w - r;
    let hr = h - r;
    format!(
        "m {r:.0} 0 l {wr:.0} 0 b {w:.0} 0 {w:.0} 0 {w:.0} {r:.0} l {w:.0} {hr:.0} b {w:.0} {h:.0} {w:.0} {h:.0} {wr:.0} {h:.0} l {r:.0} {h:.0} b 0 {h:.0} 0 {h:.0} 0 {hr:.0} l 0 {r:.0} b 0 0 0 0 {r:.0} 0"
    )
}

/// Baut für eine Wort-Highlight-Zeile mehrere Dialogue-Events (eins pro Wort-Zeitfenster),
/// bei denen jeweils genau das gerade gesprochene Wort per Inline-Farb-Tag hervorgehoben ist.
fn word_highlight_events(line: &SubtitleLine, style_name: &str) -> String {
    let accent_inline = hex_to_ass_inline(&line.accent_color);

    if line.words.is_empty() {
        // Fallback ohne Wortdaten: ganze Zeile wie im klassischen Stil anzeigen.
        return format!(
            "Dialogue: 0,{start},{end},{style},,0,0,0,,{text}\n",
            start = format_ass_time(line.start_ms),
            end = format_ass_time(line.end_ms),
            style = style_name,
            text = escape_ass_text(&line.text),
        );
    }

    let mut events = String::new();
    for (i, active) in line.words.iter().enumerate() {
        let text = line
            .words
            .iter()
            .enumerate()
            .map(|(j, w)| {
                let escaped = escape_ass_text(&w.text);
                if j == i {
                    format!("{{\\c{accent_inline}}}{escaped}{{\\c{WHITE_COLOR_INLINE}}}")
                } else {
                    escaped
                }
            })
            .collect::<Vec<_>>()
            .join(" ");

        events.push_str(&format!(
            "Dialogue: 0,{start},{end},{style},,0,0,0,,{text}\n",
            start = format_ass_time(active.start_ms + WORD_HIGHLIGHT_DELAY_MS),
            end = format_ass_time(active.end_ms + WORD_HIGHLIGHT_DELAY_MS),
            style = style_name,
        ));
    }
    events
}

/// Baut eine ASS-Untertiteldatei; jede Font/Größen/Stil/Farb-Kombination bekommt einen
/// eigenen Style. Drei Stile stehen zur Wahl: klassisch (fett, Rand), Box (gezeichnetes
/// abgerundetes Rechteck als Hintergrund) und Wort-Highlight (aktuelles Wort leuchtet auf).
fn build_ass(lines: &[SubtitleLine], play_res_x: u32, play_res_y: u32) -> String {
    let margin_v = (play_res_y as f32 * 0.28).round() as u32;
    let margin_lr = (play_res_x as f32 * 0.05).round() as u32;
    let cx = play_res_x as f32 / 2.0;
    let cy = (play_res_y as f32 - margin_v as f32).max(0.0);

    let mut style_names: HashMap<String, String> = HashMap::new();
    let mut style_defs = String::new();
    let mut events = String::new();
    let mut counter = 0usize;

    for line in lines {
        let size = scale_to_video_height(line.font_size, play_res_y);

        match line.style {
            SubtitleStyle::Box => {
                let bg_key = format!("boxbg|{}", line.accent_color);
                let bg_style = style_names
                    .entry(bg_key)
                    .or_insert_with(|| {
                        counter += 1;
                        let name = format!("SB{counter}");
                        style_defs.push_str(&box_bg_style_definition(&name, &line.accent_color));
                        name
                    })
                    .clone();

                let text_key = format!("boxtext|{}|{size}", line.font);
                let text_style = style_names
                    .entry(text_key)
                    .or_insert_with(|| {
                        counter += 1;
                        let name = format!("ST{counter}");
                        style_defs.push_str(&box_text_style_definition(&name, &line.font, size));
                        name
                    })
                    .clone();

                let (w, h) = estimate_box_size(&line.text, size);
                let radius = (size as f32 * 0.32).max(4.0);
                let bg_path = rounded_rect_drawing(w, h, radius);

                events.push_str(&format!(
                    "Dialogue: 0,{start},{end},{style},,0,0,0,,{{\\an5\\pos({cx:.0},{cy:.0})\\p1}}{bg_path}{{\\p0}}\n",
                    start = format_ass_time(line.start_ms),
                    end = format_ass_time(line.end_ms),
                    style = bg_style,
                ));
                events.push_str(&format!(
                    "Dialogue: 1,{start},{end},{style},,0,0,0,,{{\\an5\\pos({cx:.0},{cy:.0})}}{text}\n",
                    start = format_ass_time(line.start_ms),
                    end = format_ass_time(line.end_ms),
                    style = text_style,
                    text = escape_ass_text(&line.text),
                ));
            }
            SubtitleStyle::Classic | SubtitleStyle::WordHighlight => {
                let key = format!("{:?}|{}|{size}", line.style, line.font);
                let style_name = style_names
                    .entry(key)
                    .or_insert_with(|| {
                        counter += 1;
                        let name = format!("S{counter}_{}", sanitize_style_name(&line.font));
                        style_defs.push_str(&style_definition(&name, &line.font, size, margin_lr, margin_v));
                        name
                    })
                    .clone();

                if line.style == SubtitleStyle::WordHighlight {
                    events.push_str(&word_highlight_events(line, &style_name));
                } else {
                    events.push_str(&format!(
                        "Dialogue: 0,{start},{end},{style},,0,0,0,,{text}\n",
                        start = format_ass_time(line.start_ms),
                        end = format_ass_time(line.end_ms),
                        style = style_name,
                        text = escape_ass_text(&line.text),
                    ));
                }
            }
        }
    }

    format!(
        "[Script Info]\nScriptType: v4.00+\nPlayResX: {play_res_x}\nPlayResY: {play_res_y}\nScaledBorderAndShadow: yes\n\n\
[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n{style_defs}\n\
[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n{events}"
    )
}

fn escape_ffmpeg_filter_path(path: &Path) -> String {
    let s = path.to_string_lossy().replace('\\', "\\\\").replace(':', "\\:");
    format!("'{s}'")
}

/// Stellt sicher, dass der Ausgabepfad auf `.mp4` endet — der native Speichern-Dialog
/// erzwingt die Endung nicht zwingend, ohne sie kann ffmpeg das Ausgabeformat nicht
/// erraten und bricht ab (Symptom: "Rendern" tut scheinbar nichts, keine Datei landet).
fn normalize_output_path(output_path: &Path) -> PathBuf {
    match output_path.extension() {
        Some(ext) if ext.eq_ignore_ascii_case("mp4") => output_path.to_path_buf(),
        _ => {
            let mut s = output_path.to_string_lossy().to_string();
            s.push_str(".mp4");
            PathBuf::from(s)
        }
    }
}

/// Brennt die übergebenen Untertitel-Zeilen (mit individueller Font/Stil pro Zeile) ins Video ein.
/// Gibt den tatsächlich geschriebenen Ausgabepfad zurück (kann von `output_path` abweichen,
/// falls dort die `.mp4`-Endung gefehlt hat).
pub fn render_subtitled_video(
    video_path: &Path,
    lines: &[SubtitleLine],
    output_path: &Path,
) -> Result<PathBuf, String> {
    let output_path = normalize_output_path(output_path);

    let (w, h) = get_video_resolution(video_path)?;
    let ass_content = build_ass(lines, w, h);

    let tmp_ass = std::env::temp_dir().join(format!("capcut-subs-{}.ass", std::process::id()));
    std::fs::write(&tmp_ass, &ass_content)
        .map_err(|e| format!("ASS-Datei konnte nicht geschrieben werden: {e}"))?;

    let filter = format!("ass={}", escape_ffmpeg_filter_path(&tmp_ass));
    let mut cmd = Command::new("ffmpeg");
    cmd.arg("-y")
        .arg("-i")
        .arg(video_path)
        .arg("-vf")
        .arg(&filter)
        .arg("-c:a")
        .arg("aac")
        .arg("-b:a")
        .arg("192k")
        .arg("-f")
        .arg("mp4")
        .arg(&output_path);
    let result = run(cmd);

    let _ = std::fs::remove_file(&tmp_ass);
    result?;

    match std::fs::metadata(&output_path) {
        Ok(meta) if meta.len() > 0 => Ok(output_path),
        Ok(_) => Err(format!(
            "ffmpeg meldete Erfolg, aber {} ist leer.",
            output_path.display()
        )),
        Err(e) => Err(format!(
            "ffmpeg meldete Erfolg, aber die Datei {} wurde nicht gefunden: {e}",
            output_path.display()
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn word(start_ms: i64, end_ms: i64, text: &str) -> WordTiming {
        WordTiming {
            start_ms,
            end_ms,
            text: text.to_string(),
        }
    }

    fn line(text: &str, start_ms: i64, end_ms: i64, style: SubtitleStyle) -> SubtitleLine {
        SubtitleLine {
            start_ms,
            end_ms,
            text: text.to_string(),
            font: "Arial".into(),
            font_size: 28,
            style,
            accent_color: DEFAULT_ACCENT_COLOR_HEX.to_string(),
            words: Vec::new(),
        }
    }

    #[test]
    fn parses_resolution_csv_with_trailing_separator() {
        // Bug aus der Praxis (iPhone-Video, ffmpeg 9.0): ffprobe hängt einen
        // zusätzlichen Trenner an, "Ungültige Höhe" flog beim naiven split_once.
        assert_eq!(parse_resolution_csv("2160x3840x\n"), Ok((2160, 3840)));
        assert_eq!(parse_resolution_csv("2160x3840x"), Ok((2160, 3840)));
        assert_eq!(parse_resolution_csv("1920x1080\n"), Ok((1920, 1080)));
    }

    #[test]
    fn normalizes_output_path_missing_or_wrong_extension() {
        assert_eq!(
            normalize_output_path(Path::new("/tmp/out")),
            PathBuf::from("/tmp/out.mp4")
        );
        assert_eq!(
            normalize_output_path(Path::new("/tmp/out.mov")),
            PathBuf::from("/tmp/out.mov.mp4")
        );
        assert_eq!(
            normalize_output_path(Path::new("/tmp/out.mp4")),
            PathBuf::from("/tmp/out.mp4")
        );
        assert_eq!(
            normalize_output_path(Path::new("/tmp/out.MP4")),
            PathBuf::from("/tmp/out.MP4")
        );
    }

    #[test]
    fn formats_ass_timestamps() {
        assert_eq!(format_ass_time(0), "0:00:00.00");
        assert_eq!(format_ass_time(5_980), "0:00:05.98");
        assert_eq!(format_ass_time(3_661_230), "1:01:01.23");
    }

    #[test]
    fn groups_words_by_count_and_pause() {
        let words = vec![
            word(0, 200, " Hallo"),
            word(200, 400, " und"),
            word(400, 600, " herzlich"),
            word(600, 800, " willkommen"),
            word(800, 1000, " heute"),
            // 6. Wort -> neue Zeile wegen MAX_WORDS_PER_LINE
            word(1000, 1200, " zusammen"),
            // grosse Pause -> neue Zeile
            word(3000, 3200, " Tschüss"),
        ];
        let lines = group_words_into_lines(&words);
        assert_eq!(lines.len(), 3);
        assert_eq!(lines[0].text, "Hallo und herzlich willkommen heute");
        assert_eq!(lines[0].words.len(), 5);
        assert_eq!(lines[1].text, "zusammen");
        assert_eq!(lines[2].text, "Tschüss");
        assert_eq!(lines[2].start_ms, 3000);
    }

    #[test]
    fn builds_ass_with_shared_and_distinct_styles() {
        let lines = vec![
            line("Hallo", 0, 1000, SubtitleStyle::Classic),
            SubtitleLine {
                font: "Impact".into(),
                font_size: 34,
                ..line("Welt", 1000, 2000, SubtitleStyle::Classic)
            },
            line("nochmal Arial", 2000, 3000, SubtitleStyle::Classic),
        ];
        // play_res_y = 1920 -> Referenzgröße (bei 1920px definiert) wird 1:1 übernommen
        let ass = build_ass(&lines, 1080, 1920);

        assert!(ass.contains("PlayResX: 1080"));
        assert!(ass.contains("Style: S1_Arial,Arial,28"));
        assert!(ass.contains("Style: S2_Impact,Impact,34"));
        // fett (Bold=-1) und mit sichtbarem Rand statt der alten Mini-Variante
        assert!(ass.contains(",-1,0,0,0,100,100,0,0,1,"));
        // dritte Zeile nutzt denselben Style wie die erste (kein doppelter Style-Eintrag)
        assert_eq!(ass.matches("Fontname").count(), 1);
        assert!(ass.contains("Dialogue: 0,0:00:00.00,0:00:01.00,S1_Arial,,0,0,0,,Hallo"));
        assert!(ass.contains("Dialogue: 0,0:00:02.00,0:00:03.00,S1_Arial,,0,0,0,,nochmal Arial"));
    }

    #[test]
    fn parses_hex_rgb_with_fallback_for_invalid_input() {
        assert_eq!(parse_hex_rgb("#FFD400"), (0xFF, 0xD4, 0x00));
        assert_eq!(parse_hex_rgb("FF0000"), (0xFF, 0x00, 0x00));
        // ungültige Eingabe -> Fallback-Gelb statt Panik/falscher Farbe
        assert_eq!(parse_hex_rgb("nope"), (0xFF, 0xD4, 0x00));
    }

    #[test]
    fn converts_hex_to_ass_colour_formats() {
        // ASS-Reihenfolge ist BGR (bzw. AABBGGRR), nicht RGB — leicht zu verwechseln.
        assert_eq!(hex_to_ass_inline("#FF0000"), "&H0000FF&");
        assert_eq!(hex_to_ass_style_color("#FF0000"), "&H000000FF");
    }

    #[test]
    fn rounded_rect_drawing_starts_and_ends_at_corner_radius() {
        let path = rounded_rect_drawing(100.0, 40.0, 10.0);
        assert!(path.starts_with("m 10 0"));
        assert!(path.contains("l 90 0"));
        assert!(path.contains("l 100 30"));
    }

    #[test]
    fn box_style_draws_rounded_background_and_separate_text_layer() {
        let lines = vec![line("Achtung", 0, 1000, SubtitleStyle::Box)];
        let ass = build_ass(&lines, 1080, 1920);

        // zwei Events: Layer 0 = gezeichneter Hintergrund, Layer 1 = Text obendrüber
        assert_eq!(ass.matches("Dialogue:").count(), 2);
        assert!(ass.contains("Dialogue: 0,0:00:00.00,0:00:01.00"));
        assert!(ass.contains("\\p1"));
        assert!(ass.contains("\\p0"));
        assert!(ass.contains("Dialogue: 1,0:00:00.00,0:00:01.00"));
        assert!(ass.contains("\\pos("));
        assert!(ass.ends_with("Achtung\n") || ass.contains("}Achtung\n"));
        // Hintergrund-Style nutzt die Akzentfarbe als Füllfarbe (PrimaryColour)
        assert!(ass.contains(&format!("Style: SB1,Arial,10,{}", hex_to_ass_style_color(DEFAULT_ACCENT_COLOR_HEX))));
    }

    #[test]
    fn word_highlight_emits_one_event_per_word_with_accent_tag_and_delay() {
        let mut l = line("Hallo Welt", 0, 1000, SubtitleStyle::WordHighlight);
        l.words = vec![word(0, 400, "Hallo"), word(400, 1000, "Welt")];
        let ass = build_ass(&[l], 1080, 1920);
        let accent = hex_to_ass_inline(DEFAULT_ACCENT_COLOR_HEX);

        assert_eq!(ass.matches("Dialogue:").count(), 2);
        // Zeiten um WORD_HIGHLIGHT_DELAY_MS verschoben, damit's nicht "zu früh" wirkt
        assert!(ass.contains("Dialogue: 0,0:00:00.09,0:00:00.49"));
        assert!(ass.contains("Dialogue: 0,0:00:00.49,0:00:01.09"));
        // erstes Event hebt "Hallo" hervor, zweites "Welt"
        assert!(ass.contains(&format!("{{\\c{accent}}}Hallo{{\\c{WHITE_COLOR_INLINE}}} Welt")));
        assert!(ass.contains(&format!("Hallo {{\\c{accent}}}Welt{{\\c{WHITE_COLOR_INLINE}}}")));
    }

    #[test]
    fn word_highlight_uses_custom_accent_color_per_line() {
        let mut l = line("Hi", 0, 400, SubtitleStyle::WordHighlight);
        l.accent_color = "#00FF00".to_string();
        l.words = vec![word(0, 400, "Hi")];
        let ass = build_ass(&[l], 1080, 1920);
        assert!(ass.contains(&format!("{{\\c{}}}Hi{{\\c{WHITE_COLOR_INLINE}}}", hex_to_ass_inline("#00FF00"))));
    }

    #[test]
    fn escapes_backslash_and_newline_in_ass_text() {
        assert_eq!(escape_ass_text("a\\b\nc"), "a\\\\b\\Nc");
    }

    /// Läuft nicht in CI (braucht ffmpeg mit libass, whisper-cli + Modell lokal).
    /// Manuell mit `cargo test -- --ignored` ausführen.
    #[test]
    #[ignore]
    fn end_to_end_transcribe_and_burn() {
        let video = PathBuf::from(
            "/private/tmp/claude-501/-Users-finn-Documents-Claude-Projekte/aba36461-16de-4927-9d42-fe3b6b08a779/scratchpad/subtest/test_video.mp4",
        );
        let model = default_model_path();
        assert!(model.exists(), "Modell fehlt unter {}", model.display());

        let segments = transcribe_video(&video, &model, "de").expect("Transkription fehlgeschlagen");
        assert!(!segments.is_empty(), "keine Segmente transkribiert");
        assert!(segments[0].text.to_lowercase().contains("hallo"));

        let styles = [SubtitleStyle::Classic, SubtitleStyle::Box, SubtitleStyle::WordHighlight];
        let lines: Vec<SubtitleLine> = segments
            .into_iter()
            .enumerate()
            .map(|(i, s)| SubtitleLine {
                start_ms: s.start_ms,
                end_ms: s.end_ms,
                text: s.text,
                font: if i % 2 == 0 { "Arial".into() } else { "Impact".into() },
                font_size: 28,
                style: styles[i % styles.len()],
                accent_color: DEFAULT_ACCENT_COLOR_HEX.to_string(),
                words: s.words,
            })
            .collect();

        let output = std::env::temp_dir().join("capcut-e2e-test-output.mp4");
        let result_path = render_subtitled_video(&video, &lines, &output);
        assert!(result_path.is_ok(), "Render fehlgeschlagen: {:?}", result_path.err());
        let final_path = result_path.unwrap();
        assert!(final_path.exists());
        assert!(std::fs::metadata(&final_path).unwrap().len() > 0);

        let _ = std::fs::remove_file(&final_path);
    }

    /// Reproduziert den gemeldeten Bug: Speichern-Dialog liefert einen Pfad ohne
    /// `.mp4`-Endung -> ffmpeg konnte das Ausgabeformat nicht erraten und brach ab.
    #[test]
    #[ignore]
    fn end_to_end_render_with_missing_extension_and_pcm_audio() {
        let video = PathBuf::from(
            "/private/tmp/claude-501/-Users-finn-Documents-Claude-Projekte/aba36461-16de-4927-9d42-fe3b6b08a779/scratchpad/subtest/test_1080x1920_full.mov",
        );
        assert!(video.exists(), "Test-Video fehlt unter {}", video.display());

        let lines = vec![line("Test ohne Endung", 0, 2000, SubtitleStyle::Classic)];

        // Bewusst OHNE .mp4-Endung, wie es der native Speichern-Dialog liefern kann.
        let output_without_ext = std::env::temp_dir().join("capcut-e2e-no-ext-output");
        let _ = std::fs::remove_file(&output_without_ext);
        let _ = std::fs::remove_file(output_without_ext.with_extension("mp4"));

        let result = render_subtitled_video(&video, &lines, &output_without_ext);
        assert!(result.is_ok(), "Render fehlgeschlagen: {:?}", result.err());
        let final_path = result.unwrap();
        assert_eq!(final_path.extension().unwrap(), "mp4");
        assert!(final_path.exists());
        assert!(std::fs::metadata(&final_path).unwrap().len() > 0);

        let _ = std::fs::remove_file(&final_path);
    }
}
