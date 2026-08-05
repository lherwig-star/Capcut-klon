use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

/// Builds a command that starts no console window.
///
/// The app is built with `windows_subsystem = "windows"`, so it owns no console. Every
/// console child it starts gets one of its own — a black window that sits in front of the
/// app for the whole export. CREATE_NO_WINDOW suppresses that; on other platforms there is
/// nothing to suppress.
fn hidden_command(program: &str) -> Command {
    // Only the Windows branch mutates it.
    #[allow(unused_mut)]
    let mut command = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

#[derive(Clone, Serialize)]
struct ExportProgress {
    #[serde(rename = "secondsDone")]
    seconds_done: f64,
    #[serde(rename = "totalSeconds")]
    total_seconds: f64,
}

#[derive(Clone, Serialize)]
struct ExportFinished {
    success: bool,
    message: String,
}

/// Runs the system-installed ffmpeg with the given filter-graph args and streams
/// progress back to the frontend via the "export://progress" / "export://finished" events.
#[tauri::command]
pub fn export_video(app: AppHandle, args: Vec<String>, total_seconds: f64) -> Result<(), String> {
    let mut child = hidden_command("ffmpeg")
        .args(&args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| format!("ffmpeg konnte nicht gestartet werden: {err}"))?;

    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Kein stderr-Handle für ffmpeg erhalten".to_string())?;

    for line in BufReader::new(stderr).lines().map_while(Result::ok) {
        if let Some(seconds_done) = parse_ffmpeg_time(&line) {
            let _ = app.emit(
                "export://progress",
                ExportProgress {
                    seconds_done,
                    total_seconds,
                },
            );
        }
    }

    let status = child
        .wait()
        .map_err(|err| format!("Warten auf ffmpeg fehlgeschlagen: {err}"))?;

    let finished = ExportFinished {
        success: status.success(),
        message: if status.success() {
            "Export abgeschlossen".to_string()
        } else {
            format!("ffmpeg wurde mit Status {status} beendet")
        },
    };
    let _ = app.emit("export://finished", finished.clone());

    if finished.success {
        Ok(())
    } else {
        Err(finished.message)
    }
}

#[tauri::command]
pub fn check_ffmpeg_available() -> bool {
    hidden_command("ffmpeg")
        .arg("-version")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

/// Reports, per given path, whether the file carries at least one audio stream.
///
/// The export needs this before it builds its filter graph: pulling the audio pad off an
/// input that has none is a fatal error for the whole render, not a skippable warning.
/// A file ffprobe cannot read counts as having no audio - the video pass will surface the
/// real problem with a better message than a broken audio chain would.
#[tauri::command]
pub fn probe_audio_streams(paths: Vec<String>) -> Vec<bool> {
    paths
        .iter()
        .map(|path| {
            hidden_command("ffprobe")
                .args([
                    "-v", "error",
                    "-select_streams", "a",
                    "-show_entries", "stream=index",
                    "-of", "csv=p=0",
                ])
                .arg(path)
                .stdin(Stdio::null())
                .stderr(Stdio::null())
                .output()
                .map(|out| out.status.success() && !out.stdout.is_empty())
                .unwrap_or(false)
        })
        .collect()
}

/// A fresh path in the OS temp directory for a one-off export.
///
/// Used for handing the current timeline off to another part of the app (e.g. the
/// subtitle tool) without asking the user to pick a save location - the point is
/// precisely that no dialog interrupts the flow. Each call returns a distinct path so a
/// second handoff can never collide with a first one that is still being read.
#[tauri::command]
pub fn temp_export_path(extension: String) -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    std::env::temp_dir()
        .join(format!("capcut-klon-handoff-{millis}.{extension}"))
        .to_string_lossy()
        .to_string()
}

/// Parses a line of ffmpeg's stderr progress output for `time=HH:MM:SS.ss`.
fn parse_ffmpeg_time(line: &str) -> Option<f64> {
    let after = line.split("time=").nth(1)?;
    let timestamp = after.split_whitespace().next()?;
    let mut parts = timestamp.split(':');
    let hours: f64 = parts.next()?.parse().ok()?;
    let minutes: f64 = parts.next()?.parse().ok()?;
    let seconds: f64 = parts.next()?.parse().ok()?;
    Some(hours * 3600.0 + minutes * 60.0 + seconds)
}

#[cfg(test)]
mod tests {
    use super::{parse_ffmpeg_time, temp_export_path};

    #[test]
    fn parses_standard_progress_line() {
        let line = "frame=  120 fps= 30 q=-1.0 size=    2048kB time=00:00:04.00 bitrate=4194.3kbits/s speed=1.2x";
        assert_eq!(parse_ffmpeg_time(line), Some(4.0));
    }

    #[test]
    fn parses_hour_component() {
        let line = "time=01:02:03.50";
        assert_eq!(parse_ffmpeg_time(line), Some(3723.5));
    }

    #[test]
    fn returns_none_without_time_field() {
        let line = "ffmpeg version 6.0 Copyright (c) 2000-2023";
        assert_eq!(parse_ffmpeg_time(line), None);
    }

    #[test]
    fn temp_export_path_lands_in_the_os_temp_dir_with_the_given_extension() {
        let path = temp_export_path("mp4".to_string());
        assert!(path.starts_with(&std::env::temp_dir().to_string_lossy().to_string()));
        assert!(path.ends_with(".mp4"));
    }

    #[test]
    fn temp_export_path_never_repeats_so_two_handoffs_cannot_collide() {
        let first = temp_export_path("mp4".to_string());
        std::thread::sleep(std::time::Duration::from_millis(2));
        let second = temp_export_path("mp4".to_string());
        assert_ne!(first, second);
    }
}
