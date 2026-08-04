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

## Entwicklung

```bash
npm install
npm run tauri dev
```

- `npm run build` — Typecheck + Vite-Build
- `npm run lint` — ESLint
- `cargo check` (in `src-tauri/`) — Rust-Typecheck

## Empfohlenes IDE-Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
