# Install Mission Control as a Windows service using NSSM
# Run this script as Administrator
#
# NOTE: Standalone entry is at .next/standalone/mission-control/server.js
#       AppDirectory is set to .next/standalone/mission-control (subdirectory)
#       This matches the Next.js behavior of placing output in a subdir named
#       after the package "name" field when building from a subdirectory.

# Check for Administrator
if (-not ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Error "This script must be run as Administrator. Right-click PowerShell and select 'Run as Administrator'."
    exit 1
}

# Check for NSSM
if (-not (Get-Command nssm -ErrorAction SilentlyContinue)) {
    Write-Error @"
NSSM not found. Install it first:
  Option 1: choco install nssm        (if you have Chocolatey)
  Option 2: scoop install nssm        (if you have Scoop)
  Option 3: Download from https://nssm.cc/download and add to PATH
"@
    exit 1
}

$McDir = "D:\claudebot\mission-control"
# AppDirectory must be the standalone subdirectory — Next.js names it after package.json "name" field
$AppDirectory = "$McDir\.next\standalone\mission-control"
$EntryPoint = "server.js"

# Verify standalone entry point exists before registering service
if (-not (Test-Path "$AppDirectory\$EntryPoint")) {
    Write-Error "Standalone entry point not found: $AppDirectory\$EntryPoint"
    Write-Error "Run 'pnpm build' in $McDir first, then run this script."
    exit 1
}

# Find node.exe
$NodePath = (Get-Command node -ErrorAction Stop).Source

Write-Host "=== Installing claudios-mc NSSM service ===" -ForegroundColor Cyan
Write-Host "MC directory:    $McDir" -ForegroundColor Gray
Write-Host "App directory:   $AppDirectory" -ForegroundColor Gray
Write-Host "Entry point:     $AppDirectory\$EntryPoint" -ForegroundColor Gray
Write-Host "Node.js:         $NodePath" -ForegroundColor Gray

# Stop and remove existing claudios-mc service if present
Write-Host "`nRemoving existing claudios-mc service (if any)..." -ForegroundColor Yellow
nssm stop claudios-mc 2>$null
nssm remove claudios-mc confirm 2>$null

# Install the service targeting node.exe directly
Write-Host "Installing service..." -ForegroundColor Cyan
nssm install claudios-mc $NodePath "`"$EntryPoint`""

# Configure service properties
nssm set claudios-mc AppDirectory $AppDirectory
nssm set claudios-mc DisplayName "Claudios Mission Control"
nssm set claudios-mc Description "Mission Control UI (Next.js) on :3001"
nssm set claudios-mc Start SERVICE_AUTO_START
nssm set claudios-mc ObjectName LocalSystem
nssm set claudios-mc AppExit Default Restart
nssm set claudios-mc AppRestartDelay 5000

# Environment variables
# IMPORTANT: NSSM AppEnvironmentExtra syntax requires ':' prefix for first var, '+' for subsequent
Write-Host "Setting environment variables..." -ForegroundColor Cyan
nssm set claudios-mc AppEnvironmentExtra ":PORT=3001"
nssm set claudios-mc AppEnvironmentExtra "+HOSTNAME=127.0.0.1"
nssm set claudios-mc AppEnvironmentExtra "+MISSION_CONTROL_DB_PATH=D:\claudebot\mission-control\.data\mission-control.db"
nssm set claudios-mc AppEnvironmentExtra "+NEXT_TELEMETRY_DISABLED=1"
nssm set claudios-mc AppEnvironmentExtra "+NODE_OPTIONS=--max-old-space-size=512"
nssm set claudios-mc AppEnvironmentExtra "+USERPROFILE=C:\Users\omern"
nssm set claudios-mc AppEnvironmentExtra "+HOME=C:\Users\omern"
nssm set claudios-mc AppEnvironmentExtra "+NEXT_PUBLIC_GATEWAY_OPTIONAL=true"
nssm set claudios-mc AppEnvironmentExtra "+AUTH_USER=admin"
nssm set claudios-mc AppEnvironmentExtra "+AUTH_PASS=claudios-mc-local"

# Claudios integration endpoints (Phase 95)
# NOTE: Set WSHUB_PSK env var before running, or replace %WSHUB_PSK% with the actual value
#       To find the PSK: nssm get claudios AppEnvironmentExtra | findstr PSK
nssm set claudios-mc AppEnvironmentExtra "+SESSION_MANAGER_URL=http://localhost:7655"
nssm set claudios-mc AppEnvironmentExtra "+ACP_URL=http://localhost:9878"
nssm set claudios-mc AppEnvironmentExtra "+WSHUB_URL=ws://localhost:9877/ws"
nssm set claudios-mc AppEnvironmentExtra "+CLAUDIOS_API_URL=http://localhost:3000"
nssm set claudios-mc AppEnvironmentExtra "+WSHUB_PSK=%WSHUB_PSK%"

# Create logs directory and configure log redirection
New-Item -ItemType Directory -Force -Path "$McDir\logs" | Out-Null
nssm set claudios-mc AppStdout "$McDir\logs\mc-stdout.log"
nssm set claudios-mc AppStderr "$McDir\logs\mc-stderr.log"
nssm set claudios-mc AppRotateFiles 1
nssm set claudios-mc AppRotateBytes 10485760

# Ensure .data directory exists for SQLite
New-Item -ItemType Directory -Force -Path "$McDir\.data" | Out-Null

# Start the service
Write-Host "`nStarting claudios-mc service..." -ForegroundColor Cyan
nssm start claudios-mc

# Give it a moment to start
Start-Sleep -Seconds 3

$status = nssm status claudios-mc
Write-Host ""
Write-Host "=== claudios-mc service installed ===" -ForegroundColor $(if ($status -eq "SERVICE_RUNNING") { "Green" } else { "Yellow" })
Write-Host "Service name:    claudios-mc"
Write-Host "App directory:   $AppDirectory"
Write-Host "Port:            3001"
Write-Host "DB path:         D:\claudebot\mission-control\.data\mission-control.db"
Write-Host "Status:          $status"
Write-Host ""
Write-Host "Management commands:"
Write-Host "  nssm status claudios-mc    - Check status"
Write-Host "  nssm stop claudios-mc      - Stop service"
Write-Host "  nssm start claudios-mc     - Start service"
Write-Host "  nssm restart claudios-mc   - Restart service"
Write-Host "  nssm remove claudios-mc    - Uninstall service"
Write-Host ""
Write-Host "Verification:"
Write-Host "  nssm get claudios-mc AppEnvironmentExtra"
Write-Host "  Invoke-WebRequest http://localhost:3001 -UseBasicParsing"
Write-Host "  Test-Path D:\claudebot\mission-control\.data\mission-control.db"
Write-Host "  Claudios integration: SESSION_MANAGER_URL, ACP_URL, WSHUB_URL, CLAUDIOS_API_URL, WSHUB_PSK"
