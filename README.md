# Capcut-Klon

Desktop-Video-Editor (Tauri + React + TypeScript), rein client-seitige Verarbeitung. Details zur Architektur: [docs/architecture.md](docs/architecture.md). Workflow-Regeln für Menschen und KI-Assistenten: [CLAUDE.md](CLAUDE.md).

## Setup

Voraussetzungen (macOS, via [Homebrew](https://brew.sh)):

```bash
brew install node rustup
rustup toolchain install stable --profile minimal
rustup default stable
```

Für die Untertitel-Funktion (`feature/subtitles`) zusätzlich:

```bash
# ffmpeg MUSS mit libass gebaut sein (burn-in von Untertiteln), das reguläre
# homebrew/core-ffmpeg hat das nicht. Falls core-ffmpeg schon installiert ist:
#   brew uninstall ffmpeg
brew tap homebrew-ffmpeg/ffmpeg
brew install homebrew-ffmpeg/ffmpeg/ffmpeg

brew install whisper-cpp

# Multilinguales Whisper-Modell (~490MB) ins Projekt laden:
mkdir -p models
curl -L -o models/ggml-small.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin
```

`models/` ist in `.gitignore` — jeder lädt sich das Modell einmal lokal selbst.

### Windows

Ein Skript erledigt Voraussetzungen, Build und Desktop-Verknüpfung in einem:

```powershell
powershell -ExecutionPolicy Bypass -File .\install-windows.ps1
```

Es installiert fehlende Voraussetzungen (Node, Rust, ffmpeg, WebView2) über winget,
baut die App und legt „CapCut-Klon" auf dem Desktop ab. Mehrfach ausführbar.
Mit `-Bundle` entstehen zusätzlich MSI/NSIS-Installer, mit `-SkipDependencies`
wird nur gebaut.

Zusätzlich nötig, weil winget das nicht mitbringt: die **MSVC-Build-Tools**
([Download](https://visualstudio.microsoft.com/visual-cpp-build-tools/), beim
Installer „Desktopentwicklung mit C++" anhaken). Rust braucht sie zum Linken.

Für Untertitel-Transkription zusätzlich `whisper-cli` im PATH und das Modell
unter `models/ggml-small.bin` (Download-URL siehe macOS-Abschnitt oben).

## Entwicklung

```bash
npm install
npm run tauri dev
```

`tauri dev` braucht ein offenes Terminal — Vite und der Rust-Watcher laufen darin
und geben dort ihre Fehler aus. Ein fensterloser Start geht nur über die gebaute
`.exe` (siehe Windows-Abschnitt). Eine Verknüpfung dorthin legt man per
Rechtsklick → *Senden an* → *Desktop (Verknüpfung erstellen)* an; die Datei selbst
auf den Desktop zu ziehen verschiebt sie stattdessen.

- `npm run build` — Typecheck + Vite-Build
- `npm run lint` — ESLint
- `cargo check` (in `src-tauri/`) — Rust-Typecheck

## Empfohlenes IDE-Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
