# Work Log

Kurze Einträge, wenn ein Feature-Slice begonnen oder abgeschlossen wird — damit die andere Person (und ihre KI) beim Einstieg weiß, was gerade in Arbeit ist. Für die eigentliche Aufgabenverteilung: GitHub Issues / Projects-Board.

Format: `Datum — Person — Feature — Status/Notiz`

---

2026-08-04 — Setup — Repo-Grundgerüst (Tauri+React+TS), CI, CLAUDE.md, Feature-Ordner angelegt.
2026-08-04 — Setup — Branch Protection auf main noch offen (braucht Admin-Rechte auf dem Repo, hat aktuell nur lherwig-star). Bis dahin gilt die PR-Regel aus CLAUDE.md auf Vertrauensbasis. Befehl zum Nachholen liegt bereit, siehe Chat-Historie / CLAUDE.md-Workflow.
2026-08-04 — Setup — Zwei Branches angelegt: `feature/video-editing` (Lukas: timeline/preview-engine/export/media-library) und `feature/subtitles` (Finn: audio-editor/subtitles). Merge nach main läuft über PR + grüne CI, kein Cross-Review nötig — siehe CLAUDE.md.
2026-08-04 — Finn (feature/subtitles) — Erster Durchstich fertig: lokale Transkription (whisper.cpp) + Untertitel-Burn-in mit pro Zeile wählbarer Font (ffmpeg+libass). End-to-end getestet (Rust-Integrationstest + manuelle Frame-Kontrolle). Braucht ffmpeg aus dem `homebrew-ffmpeg` Tap (libass) statt core-ffmpeg — s. README.md. Noch offen: echte Font-Liste statt fest verdrahteter Auswahl, Sidecar-Bundling von ffmpeg/whisper/Modell für Produktionsbuilds, Fehler-UI für fehlendes Modell.
