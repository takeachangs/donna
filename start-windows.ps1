param(
    [string]$Project = (Join-Path $PSScriptRoot 'sandbox'),
    [int]$Port = 3014,
    [string]$OutputDevice = ''
)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$env:PYTHONUTF8 = '1'
if (-not $env:DONNA_CODEX_MODEL) { $env:DONNA_CODEX_MODEL = 'gpt-6.1-sol' }
if (-not $env:DONNA_CODEX_EFFORT) { $env:DONNA_CODEX_EFFORT = 'low' }
if (-not $env:HIGGS_HOME) { $env:HIGGS_HOME = Join-Path $PSScriptRoot '.runtime/donna' }
New-Item -ItemType Directory -Path $env:HIGGS_HOME -Force | Out-Null
if (-not $env:BOSON_API_KEY -and (Test-Path -LiteralPath '.env')) {
    foreach ($line in Get-Content -LiteralPath '.env') {
        if ($line -match '^\s*BOSON_API_KEY\s*=\s*(.+?)\s*$') {
            $env:BOSON_API_KEY = $Matches[1].Trim().Trim('"').Trim("'")
        }
    }
}
if (-not $env:BOSON_API_KEY) { throw 'Set BOSON_API_KEY in the environment or in Donna/.env.' }
if (-not (Get-Command codex -ErrorAction SilentlyContinue)) { throw 'Install Codex CLI and run codex login first.' }
if (-not (Test-Path -LiteralPath '.venv/Scripts/python.exe')) {
    python -m venv .venv
    if ($LASTEXITCODE) { throw 'Python virtual environment setup failed.' }
    & ./.venv/Scripts/python.exe -m pip install 'websockets>=13' sounddevice uv
    if ($LASTEXITCODE) { throw 'Python dependency installation failed.' }
}
$env:PATH = (Join-Path $PSScriptRoot '.venv/Scripts') + ';' + $env:PATH
if (-not (Test-Path -LiteralPath (Join-Path $Project '.git'))) {
    if ($PSBoundParameters.ContainsKey('Project')) { throw 'Choose an existing Git repository for -Project.' }
    New-Item -ItemType Directory -Path $Project -Force | Out-Null
    git -C $Project init -b main
    Set-Content -LiteralPath (Join-Path $Project 'README.md') -Value '# Donna demo workspace'
    git -C $Project add README.md
    git -C $Project commit -m 'Initialize Donna demo workspace'
    if ($LASTEXITCODE) { throw 'Demo workspace initialization failed.' }
}
$Project = (Resolve-Path -LiteralPath $Project).Path
Push-Location -LiteralPath office
try {
    if (-not (Test-Path -LiteralPath node_modules)) {
        npm ci --no-audit --no-fund
        if ($LASTEXITCODE) { throw 'Office dependency installation failed.' }
    }
    npm run build
    if ($LASTEXITCODE) { throw 'Office build failed.' }
} finally { Pop-Location }
$env:AGENCY_PORT = "$Port"
$office = Start-Process -FilePath (Get-Command node).Source -ArgumentList @('--import','tsx','apps/server/src/agency/server.ts') `
    -WorkingDirectory (Join-Path $PSScriptRoot 'office') -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $env:HIGGS_HOME 'office.log') -RedirectStandardError (Join-Path $env:HIGGS_HOME 'office-error.log')
try {
    Start-Sleep -Seconds 1
    if ($office.HasExited) { throw "Office could not start; check $env:HIGGS_HOME/office-error.log (port $Port may be in use)." }
    Write-Host "Office: http://127.0.0.1:$Port/"
    Write-Host 'Press Enter to call Donna. Say goodbye to end a call; Ctrl+C stops the phone.'
    $audio = if ($OutputDevice) { @('--out', $OutputDevice) } else { @() }
    & ./.venv/Scripts/python.exe -X utf8 bridge.py --ring --backend session --voice nora --brain $Project --brain-engine codex @audio
} finally {
    if (-not $office.HasExited) { Stop-Process -Id $office.Id }
}
