# Safe Mission Control startup tester with memory watchdog
# Kills the process if it exceeds the memory limit, protecting the machine
# NOTE: Standalone entry is at .next/standalone/mission-control/server.js
#       AppDirectory must be set to the subdirectory (Next.js subdirectory build output)

$MemLimitMB = 800
$CheckIntervalSec = 2
$TimeoutSec = 60

Write-Host "Starting Mission Control with ${MemLimitMB}MB kill limit..." -ForegroundColor Cyan
Write-Host "Will monitor for ${TimeoutSec}s then kill if still running." -ForegroundColor Cyan

$McDir = "D:\claudebot\mission-control"
$StandaloneDir = "$McDir\.next\standalone\mission-control"
$EntryPoint = "server.js"

# Verify standalone entry point exists before attempting start
if (-not (Test-Path "$StandaloneDir\$EntryPoint")) {
    Write-Error "Standalone entry point not found: $StandaloneDir\$EntryPoint"
    Write-Error "Run 'pnpm build' in $McDir first."
    exit 1
}

# Set environment variables for MC process
$env:PORT = "3001"
$env:HOSTNAME = "127.0.0.1"
$env:MISSION_CONTROL_DB_PATH = "D:\claudebot\mission-control\.data\mission-control.db"
$env:NEXT_TELEMETRY_DISABLED = "1"
$env:NODE_OPTIONS = "--max-old-space-size=512"
$env:USERPROFILE = "C:\Users\omern"
$env:HOME = "C:\Users\omern"
$env:NEXT_PUBLIC_GATEWAY_OPTIONAL = "true"
$env:AUTH_USER = "admin"
$env:AUTH_PASS = "claudios-mc-local"

Write-Host "Entry point: $StandaloneDir\$EntryPoint" -ForegroundColor Gray
Write-Host "Port: 3001" -ForegroundColor Gray
Write-Host "DB: $env:MISSION_CONTROL_DB_PATH" -ForegroundColor Gray

$proc = Start-Process -FilePath "node" `
    -ArgumentList $EntryPoint `
    -WorkingDirectory $StandaloneDir `
    -PassThru -NoNewWindow `
    -RedirectStandardOutput "$McDir\test-stdout.log" `
    -RedirectStandardError "$McDir\test-stderr.log"

Write-Host "PID: $($proc.Id)" -ForegroundColor Green

$elapsed = 0
$killed = $false

while (-not $proc.HasExited -and $elapsed -lt $TimeoutSec) {
    Start-Sleep -Seconds $CheckIntervalSec
    $elapsed += $CheckIntervalSec

    $proc.Refresh()
    $memMB = [math]::Round($proc.WorkingSet64 / 1MB)
    $cpu = $proc.TotalProcessorTime.TotalSeconds

    if ($memMB -gt $MemLimitMB) {
        Write-Host "KILLED! Memory ${memMB}MB exceeds ${MemLimitMB}MB limit at ${elapsed}s" -ForegroundColor Red
        Stop-Process -Id $proc.Id -Force
        $killed = $true
        break
    }

    Write-Host "[${elapsed}s] Memory: ${memMB}MB / ${MemLimitMB}MB limit | CPU: ${cpu}s" -ForegroundColor $(if ($memMB -gt ($MemLimitMB * 0.7)) { "Yellow" } else { "Gray" })
}

if (-not $killed -and -not $proc.HasExited) {
    Write-Host "Timeout reached (${TimeoutSec}s). Killing process." -ForegroundColor Yellow
    Stop-Process -Id $proc.Id -Force
}

if ($proc.HasExited -and -not $killed) {
    Write-Host "Process exited with code: $($proc.ExitCode)" -ForegroundColor $(if ($proc.ExitCode -eq 0) { "Green" } else { "Red" })
}

# Port check — verify MC bound to 3001
Write-Host "`n--- Port 3001 check ---" -ForegroundColor Cyan
$portCheck = Test-NetConnection -ComputerName 127.0.0.1 -Port 3001 -WarningAction SilentlyContinue
if ($portCheck.TcpTestSucceeded) {
    Write-Host "Port 3001: LISTENING (MC bound successfully)" -ForegroundColor Green
} else {
    Write-Host "Port 3001: NOT listening (MC may not have started or crashed early)" -ForegroundColor Red
}

Write-Host "`n--- stderr tail ---" -ForegroundColor Cyan
if (Test-Path "$McDir\test-stderr.log") {
    Get-Content "$McDir\test-stderr.log" -Tail 30
} else {
    Write-Host "(no stderr log found)" -ForegroundColor Gray
}
