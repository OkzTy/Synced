#Requires -Version 5.1
<#
.SYNOPSIS
    Synced Bridge Uninstaller — Clean removal of the bridge from the secondary PC.
.DESCRIPTION
    Stops running processes, deletes firewall rules, deletes URL ACLs, deletes scheduled tasks, and cleans up files.
.NOTES
    Version: 1.0.0
    Author:  Synced
    Usage:   Paste the one-liner into an elevated PowerShell prompt:
             irm "http://<MAIN_PC_IP>:9876/uninstall" | iex
#>

param(
    [int]$BridgePort = 8765
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Show-Banner {
    $banner = @"

    ███████╗██╗   ██╗███╗   ██╗ ██████╗███████╗██████╗
    ██╔════╝╚██╗ ██╔╝████╗  ██║██╔════╝██╔════╝██╔══██╗
    ███████╗ ╚████╔╝ ██╔██╗ ██║██║     █████╗  ██║  ██║
    ╚════██║  ╚██╔╝  ██║╚██╗██║██║     ██╔══╝  ██║  ██║
    ███████║   ██║   ██║ ╚████║╚██████╗███████╗██████╔╝
    ╚══════╝   ╚═╝   ╚═╝  ╚═══╝ ╚═════╝╚══════╝╚═════╝

         U N I N S T A L L E R   v 1 . 0 . 0
"@
    Write-Host $banner -ForegroundColor Magenta
    Write-Host ''
}

function Write-Step {
    param([string]$Message, [int]$Step, [int]$Total = 7)
    Write-Host "  [$Step/$Total] " -ForegroundColor Cyan -NoNewline
    Write-Host $Message -ForegroundColor White
}

function Write-OK {
    param([string]$Message)
    Write-Host "         ✓ $Message" -ForegroundColor Green
}

function Write-Fail {
    param([string]$Message)
    Write-Host "         ✗ $Message" -ForegroundColor Red
}

function Test-Administrator {
    $identity  = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)
}

function Uninstall-SyncedBridge {
    Show-Banner

    # ── Step 1: Preflight checks ──────────────────────────────────────────
    if (-not (Test-Administrator)) {
        Write-Host ''
        Write-Host '  ⚠  This uninstaller requires Administrator privileges.' -ForegroundColor Yellow
        Write-Host '     Right-click PowerShell → "Run as Administrator" and try again.' -ForegroundColor Yellow
        Write-Host ''
        return
    }

    $projectDir = "C:\Users\$env:USERNAME\Desktop\Project"
    $bridgeDir  = Join-Path $projectDir 'bridge'
    $configPath = Join-Path $bridgeDir 'config.json'
    $totalSteps = 7

    # ── Step 2: Read active Port from config ──────────────────────────────
    Write-Step 'Reading configuration...' -Step 2 -Total $totalSteps
    $activePort = $BridgePort
    if (Test-Path $configPath) {
        try {
            $cfg = Get-Content $configPath -Raw | ConvertFrom-Json
            if ($cfg.port) {
                $activePort = [int]$cfg.port
                Write-OK "Active bridge port resolved from config: $activePort"
            }
        }
        catch {
            Write-OK "Could not read config.json, defaulting to port $activePort"
        }
    } else {
        Write-OK "No config.json found. Defaulting to port $activePort"
    }

    # ── Step 3: Stop running Bridge & Agent processes ─────────────────────
    Write-Step 'Stopping running bridge and agent processes...' -Step 3 -Total $totalSteps

    # Find powershell processes running bridge-server or synced-agent
    $stoppedAny = $false
    try {
        $procs = Get-Process -Name 'powershell','pwsh' -ErrorAction SilentlyContinue | ForEach-Object {
            $procId = $_.Id
            try {
                $cmdLine = (Get-CimInstance Win32_Process -Filter "ProcessId=$procId" -ErrorAction SilentlyContinue).CommandLine
                if ($cmdLine -match 'bridge-server' -or $cmdLine -match 'synced-agent') {
                    Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
                    $stoppedAny = $true
                }
            } catch {}
        }
        if ($stoppedAny) {
            Write-OK 'Processes stopped successfully'
        } else {
            Write-OK 'No active bridge or agent processes found running'
        }
    }
    catch {
        Write-Fail "Error while stopping processes: $($_.Exception.Message)"
    }

    # ── Step 4: Unregister Scheduled Tasks ────────────────────────────────
    Write-Step 'Removing scheduled tasks...' -Step 4 -Total $totalSteps

    $tasksRemoved = 0
    foreach ($taskName in @('SyncedBridge', 'SyncedAgent')) {
        try {
            $existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
            if ($existing) {
                Unregister-ScheduledTask -TaskName $taskName -Confirm:$false | Out-Null
                Write-OK "Scheduled task '$taskName' removed"
                $tasksRemoved++
            }
        }
        catch {
            Write-Fail "Failed to remove scheduled task '$taskName': $($_.Exception.Message)"
        }
    }
    if ($tasksRemoved -eq 0) {
        Write-OK 'No scheduled tasks needed removal'
    }

    # ── Step 5: Remove Windows Firewall rule ──────────────────────────────
    Write-Step 'Removing Windows Firewall rules...' -Step 5 -Total $totalSteps

    try {
        $ruleName = 'SyncedBridge-Port-' + $activePort
        $existing = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
        if ($existing) {
            Remove-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue | Out-Null
            Write-OK "Firewall rule '$ruleName' removed"
        } else {
            # Try removing default port rule too
            $defaultRuleName = 'SyncedBridge-Port-8765'
            $defaultExisting = Get-NetFirewallRule -DisplayName $defaultRuleName -ErrorAction SilentlyContinue
            if ($defaultExisting) {
                Remove-NetFirewallRule -DisplayName $defaultRuleName -ErrorAction SilentlyContinue | Out-Null
                Write-OK "Firewall rule '$defaultRuleName' removed"
            } else {
                Write-OK 'No matching firewall rules found'
            }
        }
    }
    catch {
        Write-Fail "Failed to remove firewall rules: $($_.Exception.Message)"
    }

    # ── Step 6: Remove URL ACL reservation ────────────────────────────────
    Write-Step 'Removing HTTP URL prefix reservation...' -Step 6 -Total $totalSteps

    try {
        $urlPrefix = "http://+:$activePort/"
        $null = netsh http delete urlacl url=$urlPrefix 2>&1
        if ($activePort -ne 8765) {
            $null = netsh http delete urlacl url="http://+:8765/" 2>&1
        }
        Write-OK 'URL reservations cleaned'
    }
    catch {
        Write-Fail "Failed to clean URL reservation: $($_.Exception.Message)"
    }

    # ── Step 7: Clean up files ────────────────────────────────────────────
    Write-Step 'Deleting bridge installation files...' -Step 7 -Total $totalSteps

    try {
        if (Test-Path $bridgeDir) {
            Remove-Item $bridgeDir -Recurse -Force -ErrorAction Stop
            Write-OK "Deleted bridge directory: $bridgeDir"
        } else {
            Write-OK 'Bridge directory not found'
        }

        # Check if project directory is empty; if so, delete it
        if (Test-Path $projectDir) {
            $items = Get-ChildItem -Path $projectDir -ErrorAction SilentlyContinue
            if ($null -eq $items -or $items.Count -eq 0) {
                Remove-Item $projectDir -Force -ErrorAction SilentlyContinue
                Write-OK "Empty project directory cleaned up: $projectDir"
            }
        }
    }
    catch {
        Write-Fail "Failed to delete files: $($_.Exception.Message)"
        Write-Host "         You may need to manually delete the folder at: $bridgeDir" -ForegroundColor Yellow
    }

    Write-Host ''
    Write-Host '  Clean-up complete! Synced Bridge has been uninstalled. ✓' -ForegroundColor Green
    Write-Host ''
}

Uninstall-SyncedBridge
