# Architektur

## Plattform

Desktop-App via [Tauri v2](https://tauri.app) — nutzt das System-WebView statt Chromium mitzuliefern (kleineres Bundle als Electron). Die Business-Logik bleibt in TypeScript/React; Rust ist nur die dünne Shell-Schicht (Fenster, Dateisystem-Zugriff, Sidecar-Prozesse).

## Stack

- **Frontend:** React + TypeScript + Vite
- **Preview/Playback:** Canvas + Web Audio API — Echtzeit-Kompositierung im Browser, kein Re-Encode beim Scrubben
- **Export:** FFmpeg-Binary via Tauri-Sidecar. Die Timeline (Clips, Trims, Übergänge, Audio-Mix) wird zu einem FFmpeg-Filter-Graph übersetzt und beim Export einmalig gerendert
- **Untertitel:** SRT/VTT Import/Export im Browser; optionale Auto-Transkription über whisper.cpp lokal via Sidecar (kein Cloud-Aufruf, bleibt offline)

Alles läuft rein client-seitig auf dem Gerät des Nutzers — kein Server-Backend nötig.

## Feature-Slices

| Ordner | Zweck |
|---|---|
| `features/media-library` | Import, Thumbnails, Metadaten |
| `features/timeline` | Multi-Track-Editor, Trim/Split, Übergänge |
| `features/preview-engine` | Canvas-Compositor für Live-Vorschau |
| `features/audio-editor` | Waveform, Volume/Fades, Mixing |
| `features/subtitles` | Untertitel-Editor, SRT/VTT, Whisper-Anbindung |
| `features/export` | FFmpeg-Command-Builder, Sidecar-Steuerung |
| `features/project` | Projektdatei-Format, Speichern/Laden, Autosave |
| `shared` | UI-Kit, Types, Utils für mehrere Features |

Jedes Feature ist möglichst in sich geschlossen, damit zwei Personen parallel arbeiten können, ohne sich in denselben Dateien zu begegnen.

## Untertitel — Implementierungsstand (feature/subtitles)

Erster funktionsfähiger Durchstich, umgesetzt und end-to-end getestet:

1. `ffmpeg` extrahiert die Audiospur aus dem Video (16kHz mono WAV).
2. `whisper-cli` (whisper-cpp, Modell `ggml-small.bin`, lokal, per Metal-GPU beschleunigt) transkribiert mit Segment-Zeitstempeln.
3. Jede Zeile ist im Frontend editierbar und bekommt eine frei wählbare Font zugewiesen.
4. Beim Rendern wird daraus eine `.ass`-Untertiteldatei gebaut (ein `Style` pro genutzter Font/Größen-Kombination) und via `ffmpeg -vf ass=...` (libass) ins Video eingebrannt.

Wichtig: Das reguläre `homebrew/core`-ffmpeg wird **ohne** libass gebaut — für den Burn-in ist die Community-Tap-Version nötig (`homebrew-ffmpeg/ffmpeg`). Siehe [README.md](../README.md#setup) für die Installationsbefehle.

Aktuell rein CLI-basiert (Rust ruft `ffmpeg`/`whisper-cli` als Subprozesse auf, kein Sidecar-Bundling). Für einen Produktionsbuild müssten diese Binaries + das Modell als Tauri-Sidecar bzw. ins App-Datenverzeichnis gebündelt werden, statt sich auf global installierte Homebrew-Pakete zu verlassen — das ist bewusst zurückgestellt, um zuerst die Kernlogik zu validieren.

## Warum keine cloud-basierte Verarbeitung

Bewusste Entscheidung: einfachere Architektur (keine Queue, kein Storage-Backend, keine Server-Kosten), Verarbeitung bleibt privat auf dem Gerät. Falls das Projekt später doch serverseitiges Rendering braucht (z.B. für sehr lange Exporte), kann `features/export` durch einen Remote-Worker ersetzt werden, ohne den Rest der App anzufassen.
