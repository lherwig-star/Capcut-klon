# CLAUDE.md

Anweisungen für KI-Assistenten (Claude Code o.ä.), die an diesem Repo arbeiten. Zwei Personen entwickeln parallel an getrennten Rechnern — diese Regeln sollen Merge-Konflikte vermeiden und den Workflow vorhersehbar halten.

## Projekt

CapCut-Klon: Desktop-Video-Editor (Tauri + React + TypeScript). Kernfunktionen: Video-Schnitt, Audio-Bearbeitung, Untertitel. Verarbeitung läuft rein client-seitig (kein Server-Backend) — Export via lokales FFmpeg (Tauri-Sidecar). Details: [docs/architecture.md](docs/architecture.md).

## Ordnerstruktur & Ownership

```
src/features/<name>/   # media-library, timeline, preview-engine, audio-editor, subtitles, export, project
src/shared/            # UI-Kit, Types, Utils — von mehreren Features genutzt
src-tauri/             # Rust-Shell, FFmpeg/Whisper-Sidecar-Befehle
```

Aktuelle Zuständigkeit (Stand 2026-08-04):

| Person | Branch | Feature-Ordner |
|---|---|---|
| Lukas | `feature/video-editing` | `features/timeline`, `features/preview-engine`, `features/export`, `features/media-library` |
| Finn | `feature/subtitles` | `features/audio-editor`, `features/subtitles` |

- **Nur in den eigenen Feature-Ordnern arbeiten.** Wer an `feature/video-editing` sitzt, fasst `features/audio-editor`/`features/subtitles` nicht an und umgekehrt — dadurch gibt es praktisch keine Datei-Überschneidung zwischen den beiden Branches.
- Änderungen an `src/shared/` betreffen potenziell beide — klein halten und im Commit/PR klar als "shared:" kennzeichnen.
- `features/project` (Speichern/Laden) ist noch niemandem zugeordnet — vor Arbeit daran kurz absprechen, wer das übernimmt.
- Wenn sich die Zuständigkeit ändert oder ein drittes Themengebiet dazukommt: diese Tabelle aktualisieren.

## Git-Workflow

- **Zwei lang laufende Branches statt PR-pro-Task:** `feature/video-editing` und `feature/subtitles`. Jeder arbeitet direkt auf seinem eigenen Branch und pusht frei, ohne auf ein Approval der anderen Person zu warten — die Ordner-Trennung oben verhindert Konflikte im Alltag.
- Vor Arbeitsbeginn: `git pull origin feature/<dein-branch>`, damit man auf dem eigenen aktuellen Stand ist.
- Gelegentlich `main` in den eigenen Branch mergen/rebasen, damit man nicht zu weit auseinanderdriftet (`git fetch origin && git merge origin/main`).
- **Merge nach `main`:** PR auf, CI muss grün sein — **kein Review/Approval der anderen Person nötig**, selbst mergen sobald CI durchläuft. Der PR dient nur als Sichtbarkeit + CI-Gate, nicht als Freigabe-Prozess.
- **Nie direkt auf `main` pushen** — auch wenn kein Approval nötig ist, läuft der Merge über einen PR, damit CI durchläuft und die History nachvollziehbar bleibt.
- Merge-Konflikte in `src/shared/` oder Config-Dateien (z.B. `package.json`, `Cargo.toml`) nicht automatisch auflösen, wenn die Absicht unklar ist — beim Menschen nachfragen statt zu raten.
- Sobald ein Feature-Bereich fertig ist und der jeweilige Branch aufgelöst wird, gilt wieder die kurzlebige Konvention `feature/<bereich>-<kurzbeschreibung>` für neue Einzel-Tasks.

## Vor Abschluss einer Aufgabe

- `npm run build` (tsc + vite build) muss fehlerfrei laufen.
- `npm run lint` muss fehlerfrei laufen.
- `cargo check` in `src-tauri/` muss fehlerfrei laufen, falls Rust-Code geändert wurde.
- Kein `any` in TypeScript ohne guten Grund; strict mode ist aktiv.

## Fortschritt dokumentieren

Kurzer Eintrag in `docs/work-log.md`, wenn ein Feature-Slice begonnen oder abgeschlossen wird — hilft der anderen Person (und ihrer KI) beim Einstieg ohne Rückfrage.
