#Requires -Version 5.1
<#
.SYNOPSIS
    Synced Agent — Background monitoring and bridge watchdog.
.DESCRIPTION
    Runs silently alongside bridge-server.ps1 on the secondary PC:
    - Collects system specs every 60 seconds and caches to system-cache.json
    - Monitors bridge-server health; restarts it if it crashes
    - Logs everything to agent-log.txt
    - Rotates logs when they exceed 5 MB
.NOTES
    Version: 1.0.0
    Author:  Synced
#>

param(
    [string]$BridgeDir  = $PSScriptRoot,
    [int]$CollectInterval = 60,
    [int]$HealthCheckInterval = 15,
    [int]$MaxRestarts   = 10
)

# ── Strict mode ──────────────────────────────────────────────────────────────
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ── Paths ────────────────────────────────────────────────────────────────────
$script:SpecsCachePath  = Join-Path $BridgeDir 'system-cache.json'
$script:LogPath         = Join-Path $BridgeDir 'agent-log.txt'
$script:ConfigPath      = Join-Path $BridgeDir 'config.json'
$script:BridgeScript    = Join-Path $BridgeDir 'bridge-server.ps1'
$script:LockFile        = Join-Path $BridgeDir 'agent.lock'

# ── State ────────────────────────────────────────────────────────────────────
$script:Running         = $true
$script:RestartCount    = 0
$script:BridgeProcess   = $null
$script:LastSpecsCollect = [datetime]::MinValue
$script:LastHealthCheck  = [datetime]::MinValue

# ══════════════════════════════════════════════════════════════════════════════
#  LOGGING
# ══════════════════════════════════════════════════════════════════════════════

function Write-AgentLog {
    param(
        [string]$Message,
        [ValidateSet('INFO','WARN','ERROR','DEBUG')]
        [string]$Level = 'INFO'
    )
    $timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    $entry = "[$timestamp] [AGENT] [$Level] $Message"
    try { $entry | Out-File -FilePath $script:LogPath -Append -Encoding utf8 } catch {}
}

# ══════════════════════════════════════════════════════════════════════════════
#  SINGLE INSTANCE GUARD
# ══════════════════════════════════════════════════════════════════════════════

function Test-AlreadyRunning {
    <#
    .SYNOPSIS  Prevent duplicate agent instances via a lock file with PID.
    #>
    if (Test-Path $script:LockFile) {
        try {
            $lockPid = [int](Get-Content $script:LockFile -Raw).Trim()
            $proc = Get-Process -Id $lockPid -ErrorAction SilentlyContinue
            if ($proc -and $proc.ProcessName -match 'powershell|pwsh') {
                Write-AgentLog "Another agent instance is running (PID $lockPid). Exiting." -Level WARN
                return $true
            }
        }
        catch {
            # Stale lock file — remove and continue
        }
    }

    # Write our PID
    $PID | Set-Content $script:LockFile -Encoding utf8
    return $false
}

function Remove-LockFile {
    try { Remove-Item $script:LockFile -Force -ErrorAction SilentlyContinue } catch {}
}

# ══════════════════════════════════════════════════════════════════════════════
#  SYSTEM SPECS COLLECTION
# ══════════════════════════════════════════════════════════════════════════════

function Get-SystemSpecs {
    <#
    .SYNOPSIS  Collect full system specs and write to system-cache.json.
    #>
    try {
        $cpu  = Get-CimInstance Win32_Processor | Select-Object -First 1
        $os   = Get-CimInstance Win32_OperatingSystem
        $gpu  = Get-CimInstance Win32_VideoController | Select-Object -First 1
        $disks = Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" |
                 ForEach-Object {
                     [ordered]@{
                         drive   = $_.DeviceID
                         totalGB = [math]::Round($_.Size / 1GB, 2)
                         freeGB  = [math]::Round($_.FreeSpace / 1GB, 2)
                         usedPct = if ($_.Size -gt 0) { [math]::Round((($_.Size - $_.FreeSpace) / $_.Size) * 100, 1) } else { 0 }
                     }
                 }

        # Live performance counters
        $cpuLoad = try {
            (Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average
        } catch { 0 }

        $specs = [ordered]@{
            hostname    = $env:COMPUTERNAME
            collectedAt = (Get-Date -Format 'o')
            os          = "$($os.Caption) $($os.Version)"
            cpu         = [ordered]@{
                model       = $cpu.Name.Trim()
                cores       = $cpu.NumberOfCores
                threads     = $cpu.NumberOfLogicalProcessors
                maxClockMHz = $cpu.MaxClockSpeed
                loadPct     = $cpuLoad
            }
            ram         = [ordered]@{
                totalGB     = [math]::Round($os.TotalVisibleMemorySize / 1MB, 2)
                availableGB = [math]::Round($os.FreePhysicalMemory / 1MB, 2)
                usedPct     = [math]::Round((($os.TotalVisibleMemorySize - $os.FreePhysicalMemory) / $os.TotalVisibleMemorySize) * 100, 1)
            }
            gpu         = [ordered]@{
                model  = if ($gpu) { $gpu.Name } else { 'N/A' }
                vramMB = if ($gpu -and $gpu.AdapterRAM) { [math]::Round($gpu.AdapterRAM / 1MB) } else { 0 }
                driver = if ($gpu) { $gpu.DriverVersion } else { 'N/A' }
                status = if ($gpu) { $gpu.Status } else { 'N/A' }
            }
            disks       = @($disks)
            uptime      = [math]::Round(((Get-Date) - $os.LastBootUpTime).TotalHours, 2)
        }

        # Atomic write: write to temp then rename
        $tempFile = "$($script:SpecsCachePath).tmp"
        $specs | ConvertTo-Json -Depth 10 | Set-Content $tempFile -Encoding utf8

        if (Test-Path $script:SpecsCachePath) {
            Remove-Item $script:SpecsCachePath -Force
        }
        Rename-Item $tempFile -NewName (Split-Path $script:SpecsCachePath -Leaf)

        Write-AgentLog "Specs collected: CPU=$($cpuLoad)% RAM=$($specs.ram.usedPct)% Disk=$($disks[0].usedPct)%"
        return $true
    }
    catch {
        Write-AgentLog "Failed to collect specs: $($_.Exception.Message)" -Level ERROR
        return $false
    }
}

# ══════════════════════════════════════════════════════════════════════════════
#  BRIDGE HEALTH MONITORING
# ══════════════════════════════════════════════════════════════════════════════

function Test-BridgeRunning {
    <#
    .SYNOPSIS  Check if bridge-server.ps1 is running by looking for its process.
    #>
    $bridgeProcs = Get-Process -Name 'powershell','pwsh' -ErrorAction SilentlyContinue |
                   Where-Object {
                       try {
                           $cmdLine = (Get-CimInstance Win32_Process -Filter "ProcessId=$($_.Id)" -ErrorAction SilentlyContinue).CommandLine
                           $cmdLine -match 'bridge-server'
                       } catch { $false }
                   }
    return ($null -ne $bridgeProcs -and @($bridgeProcs).Count -gt 0)
}

function Restart-Bridge {
    <#
    .SYNOPSIS  Restart the bridge server after a crash.
    #>
    if ($script:RestartCount -ge $MaxRestarts) {
        Write-AgentLog "Max restart limit ($MaxRestarts) reached. Will not restart bridge again." -Level ERROR
        return $false
    }

    if (-not (Test-Path $script:BridgeScript)) {
        Write-AgentLog "Bridge script not found at $($script:BridgeScript)" -Level ERROR
        return $false
    }

    $script:RestartCount++
    Write-AgentLog "Restarting bridge server (attempt $($script:RestartCount)/$MaxRestarts)..." -Level WARN

    try {
        $proc = Start-Process powershell.exe -ArgumentList @(
            '-NoProfile',
            '-ExecutionPolicy', 'Bypass',
            '-WindowStyle', 'Normal',
            '-File', $script:BridgeScript
        ) -WorkingDirectory $BridgeDir -PassThru

        $script:BridgeProcess = $proc
        Start-Sleep -Seconds 3

        if (-not $proc.HasExited) {
            Write-AgentLog "Bridge restarted successfully (PID $($proc.Id))"
            return $true
        }
        else {
            Write-AgentLog "Bridge exited immediately after restart (ExitCode: $($proc.ExitCode))" -Level ERROR
            return $false
        }
    }
    catch {
        Write-AgentLog "Failed to restart bridge: $($_.Exception.Message)" -Level ERROR
        return $false
    }
}

function Invoke-HealthCheck {
    <#
    .SYNOPSIS  Verify bridge is running; attempt restart if not.
    #>
    $bridgeAlive = Test-BridgeRunning
    if ($bridgeAlive) {
        # Reset restart counter after sustained uptime
        if ($script:RestartCount -gt 0) {
            $timeSinceLast = ([datetime]::UtcNow - $script:LastHealthCheck).TotalMinutes
            if ($timeSinceLast -gt 5) {
                $script:RestartCount = [math]::Max(0, $script:RestartCount - 1)
            }
        }
        return
    }

    Write-AgentLog 'Bridge server is NOT running. Attempting restart...' -Level WARN
    Restart-Bridge | Out-Null
}

# ══════════════════════════════════════════════════════════════════════════════
#  LOG ROTATION
# ══════════════════════════════════════════════════════════════════════════════

function Invoke-LogRotation {
    <#
    .SYNOPSIS  Rotate logs when they exceed 5 MB.
    #>
    $maxSizeMB = 5

    foreach ($logFile in @($script:LogPath, (Join-Path $BridgeDir 'synced-bridge.log'))) {
        if (Test-Path $logFile) {
            $sizeMB = (Get-Item $logFile).Length / 1MB
            if ($sizeMB -gt $maxSizeMB) {
                $ext = [System.IO.Path]::GetExtension($logFile)
                $base = $logFile -replace [regex]::Escape($ext), ''
                $archiveName = "${base}-$(Get-Date -Format 'yyyyMMdd-HHmmss')${ext}"
                try {
                    Rename-Item $logFile -NewName (Split-Path $archiveName -Leaf)
                    Write-AgentLog "Rotated log: $logFile -> $archiveName"
                } catch {
                    Write-AgentLog "Log rotation failed for $logFile`: $($_.Exception.Message)" -Level WARN
                }
            }
        }
    }
}

# ══════════════════════════════════════════════════════════════════════════════
#  MAIN LOOP
# ══════════════════════════════════════════════════════════════════════════════

function Start-Agent {
    Write-AgentLog '═══════════════════════════════════════════'
    Write-AgentLog 'Synced Agent starting...'
    Write-AgentLog "PID: $PID | Bridge dir: $BridgeDir"
    Write-AgentLog "Collect interval: ${CollectInterval}s | Health check: ${HealthCheckInterval}s"

    # ── Single instance guard ─────────────────────────────────────────────
    if (Test-AlreadyRunning) {
        return
    }

    # ── Initial specs collection ──────────────────────────────────────────
    Write-AgentLog 'Performing initial specs collection...'
    Get-SystemSpecs | Out-Null
    $script:LastSpecsCollect = [datetime]::UtcNow

    # ── Initial health check ──────────────────────────────────────────────
    Write-AgentLog 'Performing initial health check...'
    Invoke-HealthCheck
    $script:LastHealthCheck = [datetime]::UtcNow

    # ── Track log rotation (once per hour) ────────────────────────────────
    $lastLogRotation = [datetime]::UtcNow

    # ── Main loop ─────────────────────────────────────────────────────────
    Write-AgentLog 'Agent is now running.'

    try {
        while ($script:Running) {
            Start-Sleep -Seconds 5

            $now = [datetime]::UtcNow

            # ── Specs collection ──────────────────────────────────────────
            if (($now - $script:LastSpecsCollect).TotalSeconds -ge $CollectInterval) {
                Get-SystemSpecs | Out-Null
                $script:LastSpecsCollect = $now
            }

            # ── Health check ──────────────────────────────────────────────
            if (($now - $script:LastHealthCheck).TotalSeconds -ge $HealthCheckInterval) {
                Invoke-HealthCheck
                $script:LastHealthCheck = $now
            }

            # ── Log rotation (hourly) ────────────────────────────────────
            if (($now - $lastLogRotation).TotalHours -ge 1) {
                Invoke-LogRotation
                $lastLogRotation = $now
            }
        }
    }
    catch {
        Write-AgentLog "Agent crashed: $($_.Exception.Message)" -Level ERROR
    }
    finally {
        Remove-LockFile
        Write-AgentLog 'Agent stopped.'
    }
}

# ── Entry point ──────────────────────────────────────────────────────────────
Start-Agent
