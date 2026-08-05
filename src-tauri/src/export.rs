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
// (async) statt nur (command): Tauri fuehrt synchrone Befehle auf dem Haupt-Thread aus.
// Dieser hier blockiert bis ffmpeg fertig ist - also fror die gesamte Oberflaeche fuer
// die Dauer des Renderns ein. Das Attribut laesst die Funktion synchron bleiben, spawnt
// sie aber abseits des Haupt-Threads.
#[tauri::command(async)]
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

#[tauri::command(async)]
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
#[tauri::command(async)]
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

/// Extracts a still frame as a base64 JPEG data URL, or `None` if ffmpeg cannot.
///
/// Done here rather than by drawing the <video> element onto a canvas in the frontend,
/// because that route cannot work in the packaged app: the page is served from
/// tauri.localhost while convertFileSrc hands out asset.localhost URLs, so the canvas is
/// cross-origin-tainted and toDataURL throws SecurityError - silently, since the caller
/// can only catch it and fall back. Going through ffmpeg also produces a thumbnail for
/// codecs the WebView cannot decode at all.
#[tauri::command(async)]
pub fn video_thumbnail(path: String, at_seconds: f64) -> Option<String> {
    // -ss before -i seeks by keyframe, which is fast even on a long file. scale keeps the
    // data URL small; -1 preserves the aspect ratio.
    let output = hidden_command("ffmpeg")
        .args(["-v", "error", "-ss"])
        .arg(format!("{at_seconds:.3}"))
        .args(["-i"])
        .arg(&path)
        .args([
            "-frames:v", "1",
            "-vf", "scale=320:-1",
            "-f", "image2",
            "-vcodec", "mjpeg",
            "-",
        ])
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .ok()?;

    if !output.status.success() || output.stdout.is_empty() {
        return None;
    }
    Some(format!(
        "data:image/jpeg;base64,{}",
        base64_encode(&output.stdout)
    ))
}

/// Minimal base64 encoder - avoids pulling in a crate for one call site.
fn base64_encode(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let n = ((b[0] as u32) << 16) | ((b[1] as u32) << 8) | b[2] as u32;
        out.push(TABLE[(n >> 18) as usize & 63] as char);
        out.push(TABLE[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 { TABLE[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if chunk.len() > 2 { TABLE[n as usize & 63] as char } else { '=' });
    }
    out
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
    fn base64_matches_the_rfc4648_test_vectors() {
        use super::base64_encode;
        // All three padding cases, from RFC 4648 section 10.
        assert_eq!(base64_encode(b""), "");
        assert_eq!(base64_encode(b"f"), "Zg==");
        assert_eq!(base64_encode(b"fo"), "Zm8=");
        assert_eq!(base64_encode(b"foo"), "Zm9v");
        assert_eq!(base64_encode(b"foob"), "Zm9vYg==");
        assert_eq!(base64_encode(b"fooba"), "Zm9vYmE=");
        assert_eq!(base64_encode(b"foobar"), "Zm9vYmFy");
    }

    #[test]
    fn base64_covers_the_whole_byte_range() {
        use super::base64_encode;
        // JPEG data is arbitrary binary; the high bytes must not be mangled.
        let all: Vec<u8> = (0u8..=255).collect();
        let encoded = base64_encode(&all);
        assert_eq!(encoded.len(), 344); // 256 bytes -> ceil(256/3)*4
        assert!(encoded.starts_with("AAECAwQFBgcICQoLDA0ODxAREhMUFRYX"));
        assert!(encoded.ends_with("f4+fr7/P3+/w=="));
    }

    #[test]
    fn temp_export_path_never_repeats_so_two_handoffs_cannot_collide() {
        let first = temp_export_path("mp4".to_string());
        std::thread::sleep(std::time::Duration::from_millis(2));
        let second = temp_export_path("mp4".to_string());
        assert_ne!(first, second);
    }
}
