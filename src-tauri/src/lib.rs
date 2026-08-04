mod export;
mod subtitles;

use std::path::PathBuf;
use subtitles::{SubtitleLine, TranscriptSegment};

#[tauri::command]
fn default_whisper_model_path() -> String {
    subtitles::default_model_path().to_string_lossy().to_string()
}

#[tauri::command]
fn transcribe_video(
    video_path: String,
    model_path: Option<String>,
    language: String,
) -> Result<Vec<TranscriptSegment>, String> {
    let video_path = PathBuf::from(video_path);
    let model_path = model_path
        .map(PathBuf::from)
        .unwrap_or_else(subtitles::default_model_path);

    if !model_path.exists() {
        return Err(format!(
            "Whisper-Modell nicht gefunden unter {}. Siehe docs/architecture.md für den Download.",
            model_path.display()
        ));
    }

    subtitles::transcribe_video(&video_path, &model_path, &language)
}

#[tauri::command]
fn render_subtitled_video(
    video_path: String,
    lines: Vec<SubtitleLine>,
    output_path: String,
) -> Result<String, String> {
    let video_path = PathBuf::from(video_path);
    let output_path = PathBuf::from(output_path);
    subtitles::render_subtitled_video(&video_path, &lines, &output_path)?;
    Ok(output_path.to_string_lossy().to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            export::export_video,
            export::check_ffmpeg_available,
            default_whisper_model_path,
            transcribe_video,
            render_subtitled_video,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
