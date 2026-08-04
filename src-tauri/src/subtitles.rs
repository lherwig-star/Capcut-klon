use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptSegment {
    pub start_ms: i64,
    pub end_ms: i64,
    pub text: String,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SubtitleLine {
    pub start_ms: i64,
    pub end_ms: i64,
    pub text: String,
    pub font: String,
    pub font_size: u32,
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
    let (w, h) = out
        .trim()
        .split_once('x')
        .ok_or_else(|| "Videoauflösung konnte nicht ermittelt werden".to_string())?;
    let w: u32 = w.trim().parse().map_err(|_| "Ungültige Breite".to_string())?;
    let h: u32 = h.trim().parse().map_err(|_| "Ungültige Höhe".to_string())?;
    Ok((w, h))
}

/// Extrahiert die Audiospur aus dem Video und transkribiert sie lokal mit whisper.cpp.
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

    Ok(parsed
        .transcription
        .into_iter()
        .map(|s| TranscriptSegment {
            start_ms: s.offsets.from,
            end_ms: s.offsets.to,
            text: s.text.trim().to_string(),
        })
        .collect())
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

/// Baut eine ASS-Untertiteldatei; jede unterschiedliche Font/Größen-Kombination
/// bekommt einen eigenen Style, damit pro Zeile eine andere Schriftart möglich ist.
fn build_ass(lines: &[SubtitleLine], play_res_x: u32, play_res_y: u32) -> String {
    let mut style_names: HashMap<(String, u32), String> = HashMap::new();
    let mut style_defs = String::new();
    let mut events = String::new();

    for (i, line) in lines.iter().enumerate() {
        let key = (line.font.clone(), line.font_size);
        let style_name = style_names.entry(key).or_insert_with(|| {
            let name = format!("S{}_{}", i, sanitize_style_name(&line.font));
            style_defs.push_str(&format!(
                "Style: {name},{font},{size},&H00FFFFFF,&H000000FF,&H00000000,&H64000000,0,0,0,0,100,100,0,0,1,2,0,2,20,20,30,1\n",
                name = name,
                font = line.font,
                size = line.font_size,
            ));
            name
        });

        events.push_str(&format!(
            "Dialogue: 0,{start},{end},{style},,0,0,0,,{text}\n",
            start = format_ass_time(line.start_ms),
            end = format_ass_time(line.end_ms),
            style = style_name,
            text = escape_ass_text(&line.text),
        ));
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

/// Brennt die übergebenen Untertitel-Zeilen (mit individueller Font pro Zeile) ins Video ein.
pub fn render_subtitled_video(
    video_path: &Path,
    lines: &[SubtitleLine],
    output_path: &Path,
) -> Result<(), String> {
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
        .arg("copy")
        .arg(output_path);
    let result = run(cmd);

    let _ = std::fs::remove_file(&tmp_ass);
    result?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_ass_timestamps() {
        assert_eq!(format_ass_time(0), "0:00:00.00");
        assert_eq!(format_ass_time(5_980), "0:00:05.98");
        assert_eq!(format_ass_time(3_661_230), "1:01:01.23");
    }

    #[test]
    fn builds_ass_with_shared_and_distinct_styles() {
        let lines = vec![
            SubtitleLine {
                start_ms: 0,
                end_ms: 1000,
                text: "Hallo".into(),
                font: "Arial".into(),
                font_size: 28,
            },
            SubtitleLine {
                start_ms: 1000,
                end_ms: 2000,
                text: "Welt".into(),
                font: "Impact".into(),
                font_size: 34,
            },
            SubtitleLine {
                start_ms: 2000,
                end_ms: 3000,
                text: "nochmal Arial".into(),
                font: "Arial".into(),
                font_size: 28,
            },
        ];
        let ass = build_ass(&lines, 640, 360);

        assert!(ass.contains("PlayResX: 640"));
        assert!(ass.contains("Style: S0_Arial,Arial,28"));
        assert!(ass.contains("Style: S1_Impact,Impact,34"));
        // dritte Zeile nutzt denselben Style wie die erste (kein doppelter Style-Eintrag)
        assert_eq!(ass.matches("Fontname").count(), 1);
        assert!(ass.contains("Dialogue: 0,0:00:00.00,0:00:01.00,S0_Arial,,0,0,0,,Hallo"));
        assert!(ass.contains("Dialogue: 0,0:00:02.00,0:00:03.00,S0_Arial,,0,0,0,,nochmal Arial"));
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

        let lines: Vec<SubtitleLine> = segments
            .into_iter()
            .enumerate()
            .map(|(i, s)| SubtitleLine {
                start_ms: s.start_ms,
                end_ms: s.end_ms,
                text: s.text,
                font: if i % 2 == 0 { "Arial".into() } else { "Impact".into() },
                font_size: 28,
            })
            .collect();

        let output = std::env::temp_dir().join("capcut-e2e-test-output.mp4");
        let result_path = render_subtitled_video(&video, &lines, &output).map(|_| output.clone());
        assert!(result_path.is_ok(), "Render fehlgeschlagen: {:?}", result_path.err());
        assert!(output.exists());
        assert!(std::fs::metadata(&output).unwrap().len() > 0);

        let _ = std::fs::remove_file(&output);
    }
}
