# Work Log

Kurze Einträge, wenn ein Feature-Slice begonnen oder abgeschlossen wird — damit die andere Person (und ihre KI) beim Einstieg weiß, was gerade in Arbeit ist. Für die eigentliche Aufgabenverteilung: GitHub Issues / Projects-Board.

Format: `Datum — Person — Feature — Status/Notiz`

---

2026-08-04 — Setup — Repo-Grundgerüst (Tauri+React+TS), CI, CLAUDE.md, Feature-Ordner angelegt.
2026-08-04 — Setup — Branch Protection auf main noch offen (braucht Admin-Rechte auf dem Repo, hat aktuell nur lherwig-star). Bis dahin gilt die PR-Regel aus CLAUDE.md auf Vertrauensbasis. Befehl zum Nachholen liegt bereit, siehe Chat-Historie / CLAUDE.md-Workflow.
2026-08-04 — Setup — Zwei Branches angelegt: `feature/video-editing` (Lukas: timeline/preview-engine/export/media-library) und `feature/subtitles` (Finn: audio-editor/subtitles). Merge nach main läuft über PR + grüne CI, kein Cross-Review nötig — siehe CLAUDE.md.
2026-08-04 — Finn (feature/subtitles) — Erster Durchstich fertig: lokale Transkription (whisper.cpp) + Untertitel-Burn-in mit pro Zeile wählbarer Font (ffmpeg+libass). End-to-end getestet (Rust-Integrationstest + manuelle Frame-Kontrolle). Braucht ffmpeg aus dem `homebrew-ffmpeg` Tap (libass) statt core-ffmpeg — s. README.md. Noch offen: echte Font-Liste statt fest verdrahteter Auswahl, Sidecar-Bundling von ffmpeg/whisper/Modell für Produktionsbuilds, Fehler-UI für fehlendes Modell.
2026-08-04 — Lukas — media-library/timeline/preview-engine/export — Erste funktionsfähige Version aller vier Feature-Slices gebaut:
  - **media-library**: Import per Dateidialog, Metadaten/Thumbnail-Probing im Browser (kein Rust nötig), Grid-UI mit Drag-Quelle für die Timeline.
  - **timeline**: Multi-Track-Editor (Video/Audio-Spuren), Clips per Drag&Drop aus der Media-Library platzieren, verschieben, an Kanten trimmen, am Playhead splitten (Taste „S“), löschen (Entf), Zoom, Mute/Hide pro Spur.
  - **preview-engine**: Canvas-Compositor, komponiert pro Frame die aktiven Clips aller sichtbaren Video-Spuren (Pool aus versteckten `<video>`/`<img>`-Elementen), Play/Pause/Seek-Loop via rAF. Audio-Wiedergabe bewusst ausgeklammert — das übernimmt `features/audio-editor`, sobald das Mixing steht.
  - **export**: Baut aus Timeline+Assets einen ffmpeg-`filter_complex` (Overlay-Kette fürs Video, `amix` fürs Audio) und lässt ihn über einen neuen Rust-Command (`src-tauri/src/export.rs`) laufen; Fortschritt kommt per Event `export://progress` zurück. Nutzt das System-ffmpeg (kein gebundeltes Sidecar-Binary bisher). v1-Einschränkung: Export mischt nur Clips von Audio-Spuren, Ton aus Video-Clips wird noch nicht mit exportiert.
  - Neue Rust-Deps: `tauri-plugin-dialog` (Datei-Dialoge) + `protocol-asset`-Feature für lokale Medien-Vorschau via `convertFileSrc`.
  - `npm run build`, `npm run lint`, `cargo check`, `cargo test` laufen fehlerfrei. Manuelles UI-Testen der Tauri-Desktop-App war in der Remote-Sandbox nicht möglich (kein Display) — bitte lokal mit `npm run tauri dev` gegenprüfen.
  - Nicht angefasst: `features/audio-editor`, `features/subtitles`, `features/project` (bleiben Finns bzw. ungeklärter Bereich).
2026-08-04 — Lukas — App-Shell — `feature/subtitles` gemergt; App.tsx bekommt eine einfache Tab-Navigation zwischen „Editor“ (Media-Library/Timeline/Preview/Export) und „Untertitel“ (Finns SubtitleEditor), bis wir gemeinsam entscheiden, wie tief die Untertitel-Integration in die Timeline gehen soll.
2026-08-04 — Lukas — media-library — Fix: Import blieb hängen (Button dauerhaft ausgegraut). probeVideo löste sein Promise nur über `seeked` auf — feuert nicht, wenn die Zielzeit der aktuellen entspricht. Jetzt Timeouts auf allen Probes, Thumbnail nur noch best-effort, Fortschrittsanzeige + konkrete Fehlermeldungen pro Datei. Asset-Protokoll-Scope auf `**` geöffnet, damit Dateien außerhalb von $HOME importierbar sind.
