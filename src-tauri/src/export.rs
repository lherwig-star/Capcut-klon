use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

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
    let mut child = Command::new("ffmpeg")
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
    Command::new("ffmpeg")
        .arg("-version")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
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
    use super::parse_ffmpeg_time;

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
}
