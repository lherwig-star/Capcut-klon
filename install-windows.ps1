<#
.SYNOPSIS
    Baut den CapCut-Klon unter Windows und legt eine Desktop-Verknüpfung an.

.DESCRIPTION
    Installiert fehlende Voraussetzungen (Node, Rust, ffmpeg, WebView2) über
    winget, holt den Quellcode, baut die App und verlinkt die fertige .exe auf
    dem Desktop. Mehrfach ausführbar: was schon da ist, wird in Ruhe gelassen.

    Zum Aktualisieren einfach erneut ausführen. Liegt das Projekt schon als
    Git-Arbeitskopie vor, wird der Stand per fetch/pull nachgezogen statt
    daneben eine zweite Kopie anzulegen - dadurch bleiben auch die Build-Caches
    von Cargo und npm erhalten und der Neubau dauert Sekunden statt Minuten.

    Die gebaute .exe startet ohne Konsolenfenster - anders als "npm run tauri
    dev", das ein Terminal braucht, weil Vite und der Rust-Watcher darin laufen.

.EXAMPLE
    # Erstinstallation an einem beliebigen Ort - klont nach %USERPROFILE%\Capcut-klon
    powershell -ExecutionPolicy Bypass -File .\install-windows.ps1

.EXAMPLE
    # Aktualisieren: aus dem Projektordner heraus erneut starten
    powershell -ExecutionPolicy Bypass -File .\install-windows.ps1

.EXAMPLE
    # zusätzlich einen MSI/NSIS-Installer erzeugen (dauert deutlich länger)
    powershell -ExecutionPolicy Bypass -File .\install-windows.ps1 -Bundle
#>

[CmdletBinding()]
param(
    [string] $Repo = "https://github.com/lherwig-star/Capcut-klon.git",
    [string] $Branch = "main",
    [string] $Destination = (Join-Path $HOME "Capcut-klon"),
    [switch] $SkipDependencies,
    [switch] $SkipUpdate,
    [switch] $Bundle,
    [switch] $NoShortcut
)

$ErrorActionPreference = "Stop"

# --------------------------------------------------------------------------
# Ausgabe-Helfer
# --------------------------------------------------------------------------

function Write-Step { param([string] $Message) Write-Host "`n==> $Message" -ForegroundColor Cyan }
function Write-Ok   { param([string] $Message) Write-Host "    OK  $Message" -ForegroundColor Green }
function Write-Note { param([string] $Message) Write-Host "    $Message" -ForegroundColor Gray }
function Write-Warn { param([string] $Message) Write-Host "    !   $Message" -ForegroundColor Yellow }

function Test-Command {
    param([Parameter(Mandatory = $true)][string] $Name)
    return [bool] (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Update-PathFromRegistry {
    <#
        winget schreibt PATH für künftige Prozesse, nicht für den laufenden.
        Neu aus beiden Scopes lesen macht frisch installierte Tools sofort
        nutzbar, statt einen Neustart der Shell zu verlangen.
    #>
    if ($PSVersionTable.PSVersion.Major -ge 6 -and -not $IsWindows) { return }

    $machine = [Environment]::GetEnvironmentVariable("Path", "Machine")
    $user = [Environment]::GetEnvironmentVariable("Path", "User")
    $combined = (@($machine, $user) | Where-Object { $_ }) -join ";"
    if ($combined) { $env:Path = $combined }
}

function Install-WithWinget {
    <#
        Installiert ein winget-Paket, sofern $Verify nicht ohnehin schon
        erfüllt ist. Über den Erfolg entscheidet $Verify, nicht winget: dessen
        Exit-Code meldet "ist bereits installiert" als Fehler.
    #>
    param(
        [Parameter(Mandatory = $true)][string] $PackageId,
        [Parameter(Mandatory = $true)][string] $Label,
        [Parameter(Mandatory = $true)][scriptblock] $Verify
    )

    if (& $Verify) {
        Write-Ok "$Label ist bereits installiert"
        return $true
    }

    Write-Note "installiere $Label (winget: $PackageId) - das kann einige Minuten dauern"
    & winget install --id $PackageId --exact --silent `
        --accept-source-agreements --accept-package-agreements | Out-Host

    Update-PathFromRegistry

    if (& $Verify) {
        Write-Ok "$Label installiert"
        return $true
    }

    Write-Warn "$Label wurde installiert, ist in diesem Fenster aber noch nicht nutzbar."
    Write-Warn "Fenster schließen, ein neues öffnen und das Skript erneut starten."
    return $false
}

function Test-WebView2 {
    <#
        WebView2 läuft nicht als AppX-Paket, Get-AppxPackage findet es also
        auch dann nicht, wenn es installiert ist. Der Registry-Eintrag des
        Evergreen-Runtime-Clients ist die verlässliche Quelle.
    #>
    $clientId = "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
    foreach ($root in @("HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients",
                        "HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients",
                        "HKCU:\SOFTWARE\Microsoft\EdgeUpdate\Clients")) {
        $entry = Get-ItemProperty (Join-Path $root $clientId) -ErrorAction SilentlyContinue
        if ($entry -and $entry.pv) { return $true }
    }
    return $false
}

function Test-MsvcToolchain {
    <#
        Rust braucht unter Windows Microsofts Linker. Nur eine Warnung, keine
        Abbruchbedingung: vswhere kennt manche Installationsvarianten nicht,
        und ein falscher Negativbefund soll niemanden ausbremsen, der die
        Build Tools längst hat.
    #>
    $programFiles = ${env:ProgramFiles(x86)}
    if (-not $programFiles) { return $false }
    $vswhere = Join-Path $programFiles "Microsoft Visual Studio\Installer\vswhere.exe"
    if (-not (Test-Path $vswhere)) { return $false }
    $found = & $vswhere -latest -products * `
        -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 `
        -property installationPath 2>$null
    return [bool] $found
}

# --------------------------------------------------------------------------
# Projekt finden
# --------------------------------------------------------------------------

Write-Host "CapCut-Klon - Windows-Setup" -ForegroundColor White

# Eine Shell, die schon vor der Installation von Node/Rust offen war, trägt
# noch das alte PATH - unabhängig von -SkipDependencies, das zwar das
# Installieren überspringen soll, nicht aber das Erkennen bereits erledigter
# Installationen.
Update-PathFromRegistry

Write-Step "Projekt suchen"

# Wo der Quellcode herkommt, wird vor dem Installieren entschieden - nur ein Klonen
# braucht git, eine vorhandene Arbeitskopie nicht zwingend.
$projectDir = $null
$mode = "clone"

if ($PSScriptRoot -and (Test-Path (Join-Path $PSScriptRoot "package.json"))) {
    # Das Skript liegt im Projekt: geklont, oder aus einem ZIP entpackt.
    $projectDir = $PSScriptRoot
    $mode = if (Test-Path (Join-Path $PSScriptRoot ".git")) { "pull" } else { "local" }
    Write-Ok "Projekt: $projectDir"
} elseif (Test-Path (Join-Path $Destination "package.json")) {
    $projectDir = $Destination
    $mode = if (Test-Path (Join-Path $Destination ".git")) { "pull" } else { "local" }
    Write-Note "vorhandene Kopie gefunden: $projectDir"
} else {
    Write-Note "das Projekt wird nach $Destination geklont"
}

$needsGit = ($mode -eq "clone")

# --------------------------------------------------------------------------
# Voraussetzungen
# --------------------------------------------------------------------------

if (-not $SkipDependencies) {
    Write-Step "Voraussetzungen prüfen"

    if (-not (Test-Command "winget")) {
        throw ("winget wurde nicht gefunden. Es gehört ab Windows 10 1809 zum " +
               "'App Installer' - den aus dem Microsoft Store installieren und erneut starten.")
    }

    if (-not (Install-WithWinget -PackageId "OpenJS.NodeJS.LTS" -Label "Node.js" `
              -Verify { Test-Command "node" })) { exit 1 }
    if (-not (Install-WithWinget -PackageId "Rustlang.Rustup" -Label "Rust" `
              -Verify { Test-Command "cargo" })) { exit 1 }
    # ffmpeg wird für den Export und das Einbrennen der Untertitel gebraucht.
    if (-not (Install-WithWinget -PackageId "Gyan.FFmpeg" -Label "ffmpeg" `
              -Verify { Test-Command "ffmpeg" })) { exit 1 }
    if (-not (Install-WithWinget -PackageId "Microsoft.EdgeWebView2Runtime" -Label "WebView2-Runtime" `
              -Verify { Test-WebView2 })) { exit 1 }
    if ($needsGit -and -not (Install-WithWinget -PackageId "Git.Git" -Label "Git" `
              -Verify { Test-Command "git" })) { exit 1 }
} else {
    Write-Step "Voraussetzungen übersprungen (-SkipDependencies)"
}

foreach ($tool in @("node", "npm", "cargo")) {
    if (-not (Test-Command $tool)) {
        throw "'$tool' ist nicht verfügbar. Ohne -SkipDependencies erneut starten, damit es installiert wird."
    }
}

$hasMsvc = Test-MsvcToolchain
if (-not $hasMsvc) {
    Write-Warn "Die MSVC-Build-Tools konnten nicht nachgewiesen werden."
    Write-Warn "Rust braucht sie unter Windows zum Linken. Falls der Build gleich am Linker"
    Write-Warn "scheitert: https://visualstudio.microsoft.com/visual-cpp-build-tools/"
    Write-Warn "installieren und dort 'Desktopentwicklung mit C++' anhaken."
}

# --------------------------------------------------------------------------
# Quellcode holen bzw. aktualisieren
# --------------------------------------------------------------------------

Write-Step "Quellcode holen"

$updateSkipped = $false

if ($mode -eq "clone") {
    Write-Note "klone $Repo ($Branch)"
    & git clone --branch $Branch $Repo $Destination | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "git clone ist fehlgeschlagen" }
    $projectDir = $Destination
    Write-Ok "geklont nach $projectDir"
} elseif ($mode -eq "pull" -and -not $SkipUpdate) {
    # In der vorhandenen Arbeitskopie aktualisieren statt daneben eine zweite anzulegen:
    # so bleiben target/ und node_modules erhalten, und der Build dauert Sekunden.
    Write-Note "aktualisiere $projectDir"

    # Nicht gesicherte eigene Arbeit würde ein Pull überschreiben.
    # Kein grosses Umlaut-A in dieser Datei: als CP1252 fehlgelesen wird daraus ein
    # tiefes Anführungszeichen, das PowerShell als String-Beginn wertet und den Rest
    # der Datei verschluckt. Der BOM verhindert das - das hier auch ohne ihn.
    # Der Build veraendert selbst Dateien im Projekt: die Tauri-CLI traegt benoetigte
    # Feature-Flags in src-tauri/Cargo.toml ein, npm kann package-lock.json umschreiben.
    # Solche Aenderungen als "Arbeit des Nutzers" zu werten hiesse, dass der erste Lauf
    # jeden weiteren blockiert und das Skript fortan stillschweigend den alten Stand baut
    # - genau das ist passiert. Statt zu raten, welche Datei von wem stammt, legt
    # --autostash alles beiseite, zieht nach und stellt es wieder her.
    $dirty = & git -C $projectDir status --porcelain
    if ($dirty) {
        Write-Note "lokale Aenderungen werden fuer das Update beiseitegelegt:"
        $dirty | Select-Object -First 10 | ForEach-Object { Write-Note "  $_" }
    }

    & git -C $projectDir fetch origin $Branch | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "git fetch ist fehlgeschlagen" }

    $current = (& git -C $projectDir rev-parse --abbrev-ref HEAD).Trim()
    if ($current -ne $Branch) {
        & git -C $projectDir checkout $Branch | Out-Host
        if ($LASTEXITCODE -ne 0) { throw "git checkout $Branch ist fehlgeschlagen" }
    }

    & git -C $projectDir pull --ff-only --autostash origin $Branch | Out-Host
    if ($LASTEXITCODE -ne 0) {
        Write-Warn "git pull ist fehlgeschlagen - es wird der vorhandene Stand gebaut."
        Write-Warn "Moegliche Ursachen: der Branch ist auseinandergelaufen, oder eine"
        Write-Warn "beiseitegelegte Aenderung liess sich nicht zurueckspielen ('git stash list')."
        $updateSkipped = $true
    } else {
        Write-Ok "auf dem aktuellen Stand von $Branch"
    }
} elseif ($mode -eq "pull") {
    Write-Note "Update übersprungen (-SkipUpdate)"
} else {
    Write-Warn "Kein Git-Ordner - dieser Stand lässt sich nicht automatisch aktualisieren."
    Write-Warn "Für künftige Updates das Skript einmal ohne Projektordner starten, dann"
    Write-Warn "wird nach $Destination geklont und ein erneuter Aufruf zieht per git nach."
}

# --------------------------------------------------------------------------
# Bauen
# --------------------------------------------------------------------------

Write-Step "npm-Pakete installieren"
Push-Location $projectDir
try {
    & npm install | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "npm install ist fehlgeschlagen" }

    Write-Step "App bauen"
    Write-Note "der erste Durchlauf kompiliert Rust komplett neu und dauert 5-15 Minuten"
    if ($Bundle) {
        & npm run tauri build | Out-Host
    } else {
        # Ohne Installer-Bundle: schneller, und es fehlt keine .exe dadurch.
        # Mit -Bundle entstehen zusätzlich MSI/NSIS-Installer.
        & npm run tauri build -- --no-bundle | Out-Host
    }
    $buildExit = $LASTEXITCODE
} finally {
    Pop-Location
}

# --------------------------------------------------------------------------
# Ergebnis suchen
# --------------------------------------------------------------------------

$releaseDir = Join-Path $projectDir "src-tauri\target\release"
$conf = Get-Content (Join-Path $projectDir "src-tauri\tauri.conf.json") -Raw | ConvertFrom-Json
$exePath = Join-Path $releaseDir "$($conf.productName).exe"

if (-not (Test-Path $exePath)) {
    # productName und der Cargo-Paketname dürfen auseinanderlaufen; cargo
    # benennt die Binärdatei nach letzterem. Nach Unterordnern wird nicht
    # gesucht: dort liegen Build-Skripte und Abhängigkeiten, keine App.
    $candidate = Get-ChildItem -Path $releaseDir -Filter *.exe -File -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if ($candidate) {
        $exePath = $candidate.FullName
        Write-Note "verwende $($candidate.Name) (weicht von productName '$($conf.productName)' ab)"
    }
}

if (-not (Test-Path $exePath)) {
    if (-not $hasMsvc) {
        Write-Warn "Der Build hat keine .exe erzeugt - sehr wahrscheinlich fehlen die MSVC-Build-Tools (siehe oben)."
    }
    throw "Build fehlgeschlagen (Exit-Code $buildExit), keine .exe unter $exePath"
}
Write-Ok "gebaut: $exePath"

# --------------------------------------------------------------------------
# Verknüpfung
# --------------------------------------------------------------------------

if (-not $NoShortcut) {
    Write-Step "Desktop-Verknüpfung anlegen"
    $shortcutPath = Join-Path ([Environment]::GetFolderPath("Desktop")) "CapCut-Klon.lnk"
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $exePath
    $shortcut.WorkingDirectory = Split-Path $exePath
    $shortcut.IconLocation = $exePath
    $shortcut.Description = "CapCut-Klon - Video-Editor"
    $shortcut.Save()
    Write-Ok "Verknüpfung: $shortcutPath"
}

# --------------------------------------------------------------------------
# Zusammenfassung
# --------------------------------------------------------------------------

Write-Host "`nFertig." -ForegroundColor White

# Der Build scrollt seitenweise vorbei; ohne diese Zeile bliebe unklar, welcher Stand
# gerade in der .exe steckt - genau die Frage, wenn eine Korrektur nicht anzukommen scheint.
if (Test-Path (Join-Path $projectDir ".git")) {
    $built = & git -C $projectDir log -1 --format="%h %s"
    Write-Host "Gebaut aus: $built" -ForegroundColor Gray
}
if ($updateSkipped) {
    Write-Warn ""
    Write-Warn "ACHTUNG: Das Update wurde uebersprungen (siehe oben) - dies ist der alte Stand."
    Write-Warn ""
}

Write-Host "Die App startet per Doppelklick auf die Verknüpfung - ohne Konsolenfenster." -ForegroundColor Gray
if ($Bundle) {
    Write-Host "Installer liegen unter src-tauri\target\release\bundle\." -ForegroundColor Gray
}
Write-Host "Zum Weiterentwickeln weiterhin 'npm run tauri dev' im Projektordner.`n" -ForegroundColor Gray
