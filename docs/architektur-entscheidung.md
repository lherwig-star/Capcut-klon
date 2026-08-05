# Architektur-Entscheidung: Vereinfachung des Projekts

Bewertung des aktuellen Stands und Vorschlag für das weitere Vorgehen.
Erstellt 2026-08-05, ausgelöst durch wiederholte Stabilitätsprobleme beim Betrieb
auf Windows.

## 1. Ursache der Komplexität

### Was ein Nutzer heute installieren muss

| Komponente | Größe | Wofür |
|---|---|---|
| Node.js + npm | ~60 MB | Baut das Frontend |
| Rust + Cargo | ~1,5 GB | Baut die native Hülle |
| MSVC Build Tools | ~2–7 GB | Rust braucht sie zum Linken |
| WebView2 | vorinstalliert | Zeigt die Oberfläche |
| ffmpeg | ~150 MB | Export, Miniaturen |
| whisper-cli + Modell | ~500 MB | Transkription |

Sechs Komponenten, zwei Paketmanager, drei Sprachen (TypeScript, Rust, CSS),
196 npm-Pakete und 474 Rust-Crates transitiv. Ein Build von Null dauert 5–15 Minuten.

### Was diese Komplexität tatsächlich gekostet hat

13 Fehlerbehebungen bisher. Nach Ursache aufgeschlüsselt:

**Durch den Web/Tauri-Stack verursacht (9):**

| Fehler | Eigentliche Ursache |
|---|---|
| Drag & Drop tot | Tauris `dragDropEnabled` fängt Zeiger-Events auf OS-Ebene ab |
| App fror beim Rendern ein | Tauri führt synchrone Befehle auf dem Haupt-Thread aus |
| Miniaturen blieben generisch (2×) | Canvas-Tainting: Seite und Datei haben verschiedene Herkunft |
| Vorschau aus dem Bild geschoben | CSS-Grid-Kinder haben `min-width: auto` |
| Wiedergabe lief nie los | React-Hook-Closures starteten die Render-Schleife neu |
| Import hing endlos | `HTMLMediaElement` feuert bestimmte Events nicht |
| Vorschau blieb schwarz | Seek ist asynchron, Zeichnen erfolgte zu früh |
| Text-Markierung beim Scrubben | Native Textauswahl übernimmt den Zeiger |

**Durch die Toolchain verursacht (2):** Beide Fehler im PowerShell-Installationsskript
existieren nur, weil vier Komponenten koordiniert installiert werden müssen.

**Echte Fachprobleme (2):** ffprobe-Ausgabe parsen, Dateiendung beim Rendern.

**Das ist der entscheidende Befund: 11 von 13 Fehlern kamen nicht aus der
Videobearbeitung, sondern aus der Architektur drumherum.**

### Was die Rust-Schicht wirklich tut

1225 Zeilen Rust. Inhaltlich: Prozesse starten (`ffmpeg`, `ffprobe`, `whisper-cli`),
deren Ausgabe parsen, Strings zurückgeben. Zehn Prozessaufrufe insgesamt.

Dafür sind Rust, Cargo und die MSVC Build Tools nötig — also die mit Abstand
schwerste Installationslast des Projekts, für Code, der in Python
`subprocess.run(...)` wäre.

## 2. Was wirklich notwendig ist

**Unverzichtbar:**

- **ffmpeg** — macht die eigentliche Arbeit (Schnitt, Kodierung, Untertitel-Einbrennen).
  Nicht ersetzbar, aber mitlieferbar.
- **whisper** — Transkription. Nicht ersetzbar, aber mitlieferbar.
- **Eine Oberflächen-Bibliothek** — irgendetwas muss Fenster und Timeline zeichnen.

**Ersetzbar:**

- **Rust + Cargo + MSVC Build Tools** — existieren nur, um Prozesse zu starten.
- **Node.js + npm + Vite** — existieren nur, um TypeScript zu bauen.
- **WebView2 + React + CSS** — eine von mehreren Möglichkeiten, Oberfläche zu bauen;
  bringt aber die Browser-Eigenheiten mit, die 9 der 13 Fehler verursacht haben.

## 3. Vorgeschlagene Zielarchitektur

**Python 3.11+ mit PySide6**, verpackt mit PyInstaller.

```
capcut/
  __main__.py         Einstiegspunkt
  media.py            Import, Metadaten via ffprobe
  timeline.py         Datenmodell (Spuren, Clips, Trim, Split)
  timeline_view.py    Timeline-Oberfläche (QGraphicsView)
  preview.py          Vorschau + Wiedergabe
  export.py           ffmpeg-Filtergraph
  subtitles.py        whisper + Untertitel-Einbrennen
  bundled/            mitgelieferte ffmpeg/whisper-Binaries
```

**Eine Sprache, ein Paketmanager, keine Compiler-Toolchain.**

### Warum PySide6 und nicht etwas anderes

- Qt bringt seine Binaries über `pip` mit — kein C++-Compiler nötig.
- `QGraphicsView` ist für eine Timeline gut geeignet: Elemente mit Position, Ziehen
  und Auswahl sind eingebaut, statt in CSS und Zeiger-Ereignissen nachgebaut zu werden.
- PyInstaller kann ffmpeg und whisper mit in die `.exe` legen — genau die Anforderung,
  dass Nutzer nichts von Hand installieren.
- Ihr habt mit dem Colorgrading-Projekt bereits belegt, dass dieser Weg für euch
  funktioniert.

### Was der Nutzer danach tut

Eine `.exe` herunterladen, doppelklicken. Kein Node, kein Rust, keine Build Tools,
kein PATH, kein Modell-Download von Hand.

## 4. Was entfällt

| Entfällt | Zeilen |
|---|---|
| Rust-Schicht komplett | 1225 |
| TypeScript/TSX | 2529 |
| CSS | 1208 |
| TS-Tests + e2e | 1954 |
| PowerShell-Installationsskript | 411 |
| Vite-, TS-, ESLint-, Vitest-, Playwright-Konfiguration | ~150 |

Auch weg: 196 npm-Pakete, 474 Cargo-Crates, jsdom, Playwright, die gesamte CI-Matrix
aus drei Jobs.

Neu dazu: Python-Code, geschätzt 1200–1800 Zeilen, plus pytest.

## 5. Risiken — ehrlich benannt

**Hoch:**

- **Es ist eine Neuentwicklung, keine Umstellung.** Der bestehende Oberflächen-Code ist
  nicht übertragbar. Realistischer Aufwand: mehrere Arbeitstage.
- **Die Vorschau ist der schwierigste Teil.** Im Browser waren Canvas und
  `<video>`-Element für die Mehrspur-Kompositierung gratis. In Qt gibt es das nicht
  fertig. Zwei gangbare Wege: Einzelbilder per ffmpeg dekodieren und anzeigen
  (robust, aber beim Scrubben träger), oder `QMediaPlayer` für den aktiven Clip
  (flüssig, aber ohne echte Mehrspur-Überlagerung).

**Mittel:**

- **Die Bündelung muss man einmal richtig hinbekommen.** PyInstaller mit Qt und
  fremden Binaries hat eigene Fallstricke. Der erste Installer wird nicht auf Anhieb
  sitzen.
- **Die Untertitel-Arbeit deines Kollegen müsste ebenfalls portiert werden.** Das
  betrifft ihn, nicht nur dich — das gehört abgesprochen, bevor irgendetwas passiert.
- **`.exe`-Größe** steigt auf 300–600 MB, weil Qt, Python, ffmpeg und whisper
  mitreisen. Für eine lokal installierte App vertretbar.

**Gering:**

- Das fachliche Wissen bleibt erhalten: der ffmpeg-Filtergraph, die
  Timeline-Regeln und die Untertitel-Logik sind übertragbar. Die Tests dafür
  beschreiben genau das gewünschte Verhalten und dienen als Vorlage.

## 6. Ehrliche Gegenrechnung

Was für ein Beibehalten spräche:

- Es funktioniert inzwischen. Die letzten Fehler sind behoben, Tests sichern sie ab.
- Eine Neuentwicklung wirft mehrere Tage Arbeit weg.
- Man handelt sich neue, noch unbekannte Fehler ein, statt bekannte zu behalten.

Was dagegen spricht:

- Die Fehlerquellen sind nicht zufällig verteilt. Sie sitzen strukturell in der
  Browser- und Tauri-Schicht und werden weiter auftreten.
- Die Anforderung „ein Installationsvorgang, nichts von Hand" ist mit dem aktuellen
  Stack nur mit erheblichem Zusatzaufwand erreichbar (Sidecar-Konfiguration,
  Signaturschlüssel, Installer-Bündelung) — mit PyInstaller ist sie im Wesentlichen
  eingebaut.
- Der Funktionsumfang rechtfertigt die Architektur nicht. Für einen einspurigen
  Schnitt mit Export und Untertiteln sind drei Sprachen und eine C++-Toolchain
  unverhältnismäßig.

**Empfehlung: Neuentwicklung in Python.** Nicht weil Web-Technologie schlecht wäre,
sondern weil sie für diesen Funktionsumfang und diese Anforderungen die falsche
Wahl war.

## 7. Reihenfolge der Umstellung

Jeder Schritt endet mit einem lauffähigen Programm.

1. **Grundgerüst** — PySide6-Fenster, das startet. Beweist die Toolchain.
2. **Binaries auffinden** — `bundled/` mit Rückfall auf PATH. Eine Stelle, die
   entscheidet, wo ffmpeg herkommt.
3. **Medien-Import** — Datei wählen, Metadaten per ffprobe, Miniatur per ffmpeg.
   *Hier verschwindet der Tainting-Fehler ersatzlos.*
4. **Timeline-Datenmodell** — direkt aus `timelineReducer.ts` übernommen, dessen
   25 Tests als Vorlage für die pytest-Tests dienen.
5. **Timeline-Oberfläche** — `QGraphicsView` mit Clips, Ziehen, Trimmen, Trennen.
6. **Vorschau** — zuerst nur Standbild an der Abspielposition, dann Wiedergabe.
7. **Export** — der bestehende Filtergraph, gegen echtes ffmpeg getestet.
8. **Untertitel** — Portierung, mit deinem Kollegen abgestimmt.
9. **Installer** — PyInstaller mit mitgelieferten Binaries, eine `.exe`.

Nach Schritt 7 ist der Funktionsumfang des heutigen Editors erreicht.

## 8. Falls kein Wechsel gewünscht ist

Dann wäre die sinnvolle Reduktion innerhalb des jetzigen Stacks:

- Die Rust-Schicht auf das Nötigste zusammenstreichen und alle Prozessaufrufe über
  **eine** gemeinsame Funktion führen (halb erledigt: `hidden_command`).
- ffmpeg und whisper als Tauri-Sidecar mitliefern statt sie im PATH zu erwarten.
- Das PowerShell-Skript durch einen echten Installer (NSIS über `tauri build`) ersetzen.

Das beseitigt die Installationslast für Nutzer, **nicht** aber für Entwickler — Node,
Rust und die MSVC Build Tools bleiben nötig. Und die Browser-Eigenheiten bleiben
ebenfalls.
