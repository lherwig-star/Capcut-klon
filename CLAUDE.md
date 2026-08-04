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

- **Nicht in einem `features/<name>`-Ordner arbeiten, den gerade jemand anderes bearbeitet**, außer explizit angefragt. Vor Arbeitsbeginn in `docs/work-log.md` bzw. dem GitHub-Projects-Board nachsehen, wer woran sitzt.
- Änderungen an `src/shared/` sind riskanter (betreffen beide) — klein halten, im PR-Titel klar als "shared:" kennzeichnen.
- Neue Features bekommen einen eigenen Ordner unter `src/features/`, keine Querverweise zwischen Features außer über `src/shared/`.

## Git-Workflow

- **Nie direkt auf `main` pushen.** Immer von `main` branchen: `feature/<bereich>-<kurzbeschreibung>`.
- Vor Branch-Erstellung: `git pull origin main`.
- Vor dem Push: auf aktuellen `main` rebasen.
- Kleine, häufige PRs statt lange laufende Branches.
- `main` ist geschützt: PR + grüne CI sind Pflicht.
- Merge-Konflikte in `src/shared/` oder Config-Dateien nicht automatisch aufheben, wenn die Absicht unklar ist — beim Menschen nachfragen statt zu raten.

## Vor Abschluss einer Aufgabe

- `npm run build` (tsc + vite build) muss fehlerfrei laufen.
- `npm run lint` muss fehlerfrei laufen.
- `cargo check` in `src-tauri/` muss fehlerfrei laufen, falls Rust-Code geändert wurde.
- Kein `any` in TypeScript ohne guten Grund; strict mode ist aktiv.

## Fortschritt dokumentieren

Kurzer Eintrag in `docs/work-log.md`, wenn ein Feature-Slice begonnen oder abgeschlossen wird — hilft der anderen Person (und ihrer KI) beim Einstieg ohne Rückfrage.
