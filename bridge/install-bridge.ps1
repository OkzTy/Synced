#Requires -Version 5.1
<#
.SYNOPSIS
    Universal Synced Setup & Bridge Installer — One-paste setup for any secondary PC.
.DESCRIPTION
    1. Downloads and silently installs the Synced GUI app from GitHub.
    2. Configures the built-in Synced Bridge.
    3. Adds Windows Firewall rules and URL ACL reservations.
    4. Registers Synced to auto-start on Windows Logon (Startup Folder).
    5. Starts the Synced GUI app immediately (which starts the built-in bridge server).
    6. Automatically registers with the Main PC to establish linking.
.NOTES
    Usage: Run in an elevated PowerShell prompt:
           irm "http://$MAIN_PC_IP:9876/install" | iex
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

         U N I V E R S A L   I N S T A L L E R
"@
    Write-Host $banner -ForegroundColor Magenta
    Write-Host ''
}

function Write-Step {
    param([string]$Message, [int]$Step, [int]$Total = 10)
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

function New-Shortcut {
    param(
        [string]$SourcePath,
        [string]$Arguments = "",
        [string]$ShortcutPath,
        [string]$IconPath = "",
        [string]$Description = ""
    )
    $wshShell = New-Object -ComObject WScript.Shell
    $shortcut = $wshShell.CreateShortcut($ShortcutPath)
    $shortcut.TargetPath = $SourcePath
    if ($Arguments) { $shortcut.Arguments = $Arguments }
    if ($IconPath) { $shortcut.IconLocation = $IconPath }
    if ($Description) { $shortcut.Description = $Description }
    $shortcut.Save()
}

function Install-SyncedAndBridge {
    Show-Banner

    # ── Preflight checks ──────────────────────────────────────────────────
    if (-not (Test-Administrator)) {
        Write-Host ''
        Write-Host '  ⚠  This installer requires Administrator privileges.' -ForegroundColor Yellow
        Write-Host '     Right-click PowerShell → "Run as Administrator" and try again.' -ForegroundColor Yellow
        Write-Host ''
        return
    }

    $bridgeDir = Join-Path $env:LOCALAPPDATA "synced-bridge"
    $totalSteps = 10

    # Ensure TLS 1.2
    [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12

    # ── Preflight: Clean up old bridge installations ──────────────────────
    Write-Step 'Cleaning up any old external bridge installations...' -Step 0 -Total $totalSteps
    try {
        # Stop old bridge processes
        Get-Process -Name 'ProjectBridge' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
        
        # Stop old powershell bridge/agent tasks
        Get-Process -Name 'powershell','pwsh' -ErrorAction SilentlyContinue | ForEach-Object {
            $procId = $_.Id
            try {
                $cmdLine = (Get-CimInstance Win32_Process -Filter "ProcessId=$procId" -ErrorAction SilentlyContinue).CommandLine
                if ($cmdLine -match 'bridge-server' -or $cmdLine -match 'synced-agent') {
                    Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
                }
            } catch {}
        }

        # Remove old scheduled tasks
        foreach ($taskName in @('SyncedBridge', 'SyncedAgent')) {
            $existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
            if ($existing) {
                Unregister-ScheduledTask -TaskName $taskName -Confirm:$false | Out-Null
            }
        }

        # Remove firewall rules for port 8765
        Remove-NetFirewallRule -DisplayName "SyncedBridge-Port-8765" -ErrorAction SilentlyContinue
        
        Write-OK "Old external bridge components stopped and cleaned up."
    }
    catch {
        Write-Host "  Note: Some old bridge components could not be removed: $($_.Exception.Message)" -ForegroundColor Yellow
    }

    # ── Step 1: Resolve main PC package source ────────────────────────────
    Write-Step 'Resolving Synced package source from Main PC...' -Step 1 -Total $totalSteps
    $installerUrl = 'http://$MAIN_PC_IP:9876/download'
    Write-OK "Target package path: $installerUrl"

    # ── Step 2: Download Synced Installer ─────────────────────────────────
    Write-Step 'Downloading Synced Installer from Main PC...' -Step 2 -Total $totalSteps
    $installerPath = Join-Path $env:TEMP "SyncedSetup.exe"
    try {
        $wc = New-Object System.Net.WebClient
        $wc.DownloadFile($installerUrl, $installerPath)
        $wc.Dispose()
        Write-OK "Installer downloaded from Main PC."
    }
    catch {
        Write-Fail "Download failed from Main PC. Resolving latest setup package from GitHub..."
        try {
            $githubApiUrl = "https://api.github.com/repos/OkzTy/Synced/releases/latest"
            $releaseInfo = Invoke-RestMethod -Uri $githubApiUrl -UseBasicParsing
            $asset = $releaseInfo.assets | Where-Object { $_.name -like "*.exe" } | Select-Object -First 1
            
            if ($asset -and $asset.browser_download_url) {
                $fallbackUrl = $asset.browser_download_url
                Write-Host "  Found release asset: $($asset.name)" -ForegroundColor Green
            } else {
                $fallbackUrl = "https://github.com/OkzTy/Synced/releases/download/v1.0.9/Synced.Setup.1.0.9.exe"
            }
            
            $wc = New-Object System.Net.WebClient
            $wc.Headers.Add("User-Agent", "Mozilla/5.0")
            $wc.DownloadFile($fallbackUrl, $installerPath)
            $wc.Dispose()
            Write-OK "Latest installer package downloaded from GitHub releases."
        }
        catch {
            Write-Fail "GitHub download failed: $($_.Exception.Message)"
            return
        }
    }

    # ── Step 3: Install Synced Silently ───────────────────────────────────
    Write-Step 'Installing Synced application silently...' -Step 3 -Total $totalSteps
    try {
        $process = Start-Process -FilePath $installerPath -ArgumentList "/S" -PassThru -Wait -NoNewWindow
        Write-OK "Synced GUI installed successfully."
    }
    catch {
        Write-Fail "Silent install failed: $($_.Exception.Message)"
        return
    }

    # ── Step 4: Create Synced GUI Desktop Shortcut ────────────────────────
    Write-Step 'Creating Synced app desktop shortcut...' -Step 4 -Total $totalSteps
    $syncedExePath = Join-Path $env:LOCALAPPDATA "Programs\synced\Synced.exe"
    $syncedShortcutPath = Join-Path $env:USERPROFILE "Desktop\Synced.lnk"
    try {
        if (Test-Path $syncedExePath) {
            New-Shortcut -SourcePath $syncedExePath -ShortcutPath $syncedShortcutPath -Description "Synced Dual-PC Manager"
            Write-OK "Desktop shortcut created: $syncedShortcutPath"
        } else {
            $altPath = Join-Path $env:ProgramFiles "Synced\Synced.exe"
            if (Test-Path $altPath) {
                $syncedExePath = $altPath
                New-Shortcut -SourcePath $altPath -ShortcutPath $syncedShortcutPath -Description "Synced Dual-PC Manager"
                Write-OK "Desktop shortcut created (Alt Path): $syncedShortcutPath"
            } else {
                Write-Host "  Could not locate installed Synced.exe. Shortcut skipped." -ForegroundColor Yellow
            }
        }
    }
    catch {
        Write-Host "  Failed to create desktop shortcut: $($_.Exception.Message)" -ForegroundColor Yellow
    }

    # ── Step 5: Ensure bridge directory exists ───────────────────────────
    Write-Step 'Configuring bridge directory...' -Step 5 -Total $totalSteps
    try {
        if (-not (Test-Path $bridgeDir)) {
            New-Item -ItemType Directory -Path $bridgeDir -Force | Out-Null
        }
        Write-OK "Bridge directory ready at: $bridgeDir"
    }
    catch {
        Write-Fail "Failed to configure directory: $($_.Exception.Message)"
        return
    }

    # ── Step 6: Generate Auth Token & config.json ─────────────────────────
    Write-Step 'Generating authentication configuration...' -Step 6 -Total $totalSteps
    $configPath = Join-Path $bridgeDir "config.json"
    $token = ""
    try {
        if (Test-Path $configPath) {
            try {
                $existing = Get-Content $configPath -Raw | ConvertFrom-Json
                $token = $existing.token
            } catch {}
        }
        
        if ([string]::IsNullOrEmpty($token)) {
            $bytes = New-Object byte[] 32
            $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
            $rng.GetBytes($bytes)
            $token = ($bytes | ForEach-Object { $_.ToString('x2') }) -join ''
            $rng.Dispose()
        }

        $config = [ordered]@{
            token     = $token
            port      = $BridgePort
            createdAt = (Get-Date -Format 'o')
            hostname  = $env:COMPUTERNAME
        }
        $config | ConvertTo-Json -Depth 4 | Set-Content $configPath -Encoding utf8
        Write-OK "config.json generated at $configPath"
    }
    catch {
        Write-Fail "Config generation failed: $($_.Exception.Message)"
        return
    }

    # ── Step 6b: Write settings.json to bypass wizard ─────────────────────
    Write-Step 'Configuring settings to bypass onboarding wizard...' -Step 6 -Total $totalSteps
    $appDataSyncedDir = Join-Path $env:APPDATA "synced"
    $appSettingsPath = Join-Path $appDataSyncedDir "settings.json"
    try {
        if (-not (Test-Path $appDataSyncedDir)) {
            New-Item -ItemType Directory -Path $appDataSyncedDir -Force | Out-Null
        }
        
        # Get local IP for secondary PC
        $localIP = (Get-NetIPAddress -AddressFamily IPv4 |
                    Where-Object { $_.InterfaceAlias -notmatch 'Loopback' -and $_.IPAddress -ne '127.0.0.1' } |
                    Select-Object -First 1).IPAddress

        $customization = $null
        try {
            $customization = '$USER_CUSTOMIZATION' | ConvertFrom-Json
        } catch {}

        $appSettings = [ordered]@{
            theme         = "$USER_THEME"
            language      = "$USER_LANGUAGE"
            setupComplete = $true
            licenseKey    = "$USER_LICENSE_KEY"
            profile       = @{
                username     = "$USER_USERNAME"
                passwordHash = "$USER_PASSWORD_HASH"
                pinHash      = "$USER_PIN_HASH"
                pfpType      = "$USER_PFP_TYPE"
                pfpValue     = "$USER_PFP_VALUE"
            }
            bridge        = @{
                ip    = $localIP
                port  = $BridgePort
                token = $token
            }
            customization = $customization
        }
        $appSettings | ConvertTo-Json -Depth 4 | Set-Content $appSettingsPath -Encoding utf8
        Write-OK "settings.json pre-configured at $appSettingsPath"
    }
    catch {
        Write-Fail "Failed to configure settings.json: $($_.Exception.Message)"
    }

    # ── Step 7: Configure Windows Firewall ────────────────────────────────
    Write-Step 'Configuring Windows Firewall rules...' -Step 7 -Total $totalSteps
    try {
        $ruleName = "SyncedBridge-Port-$BridgePort"
        Remove-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
        New-NetFirewallRule `
            -DisplayName $ruleName `
            -Direction Inbound `
            -Protocol TCP `
            -LocalPort $BridgePort `
            -Action Allow `
            -Profile Private,Domain `
            -Description 'Allow Synced Bridge HTTP listener on local network' | Out-Null
        Write-OK "Firewall inbound rule added on port $BridgePort."
    }
    catch {
        Write-Fail "Firewall rule creation failed: $($_.Exception.Message)"
    }

    # ── Step 8: Reserve URL ACL ───────────────────────────────────────────
    Write-Step 'Registering URL ACL reservation...' -Step 8 -Total $totalSteps
    try {
        $urlPrefix = "http://+:$BridgePort/"
        $null = netsh http delete urlacl url=$urlPrefix 2>&1
        $result = netsh http add urlacl url=$urlPrefix user="$env:USERDOMAIN\$env:USERNAME"
        if ($LASTEXITCODE -ne 0) { throw $result }
        Write-OK "URL reservation established: $urlPrefix"
    }
    catch {
        Write-Fail "URL ACL reservation failed: $($_.Exception.Message)"
    }

    # ── Step 9: Configure Windows Startup shortcut & Start Synced ──────────
    Write-Step 'Registering auto-start and launching Synced...' -Step 9 -Total $totalSteps
    try {
        $startupFolder = [System.IO.Path]::Combine($env:APPDATA, "Microsoft\Windows\Start Menu\Programs\Startup")
        $startupShortcutPath = Join-Path $startupFolder "Synced.lnk"
        if (Test-Path $syncedExePath) {
            New-Shortcut -SourcePath $syncedExePath -ShortcutPath $startupShortcutPath -Description "Synced Dual-PC Manager Startup"
            
            # Start Synced application (which fires built-in bridge)
            Start-Process -FilePath $syncedExePath
            Write-OK "Synced GUI launched and registered in Windows Startup."
        } else {
            Write-Fail "Could not find Synced.exe to launch."
        }
    }
    catch {
        Write-Fail "Failed to configure startup or launch app: $($_.Exception.Message)"
    }

    # ── Step 10: Automatic Pairing & Hardware Specs Reporting ─────────────
    Write-Step 'Reporting hardware details to Main PC for automatic linking...' -Step 10 -Total $totalSteps
    try {
        # Query Specs
        $cpuBrand = (Get-CimInstance Win32_Processor).Name
        $cpuCores = (Get-CimInstance Win32_Processor).NumberOfCores
        $ramTotal = [Math]::Round((Get-CimInstance Win32_PhysicalMemory | Measure-Object -Property Capacity -Sum).Sum / 1GB, 1)
        
        $gpuModel = "N/A"
        $gpuVram = 0
        try {
            $gpu = Get-CimInstance Win32_VideoController | Select-Object -First 1
            if ($gpu) {
                $gpuModel = $gpu.Name
                $gpuVram = [Math]::Round($gpu.AdapterRAM / 1MB, 0)
            }
        } catch {}
        
        $osName = (Get-CimInstance Win32_OperatingSystem).Caption

        $specs = @{
            cpu = @{ model = $cpuBrand; cores = $cpuCores }
            ram = @{ totalGB = $ramTotal }
            gpu = @{ model = $gpuModel; vramMB = $gpuVram }
            os = $osName
        }

        # Resolve local IP address
        $localIP = (Get-NetIPAddress -AddressFamily IPv4 |
                    Where-Object { $_.InterfaceAlias -notmatch 'Loopback' -and $_.IPAddress -ne '127.0.0.1' } |
                    Select-Object -First 1).IPAddress

        $payload = @{
            ip = $localIP
            port = $BridgePort
            token = $token
            hostname = $env:COMPUTERNAME
            specs = $specs
        } | ConvertTo-Json -Depth 4

        # POST registration call to Main PC
        # $MAIN_PC_IP is replaced dynamically at download by api-server.js
        $registerUrl = 'http://$MAIN_PC_IP:9876/api/link/auto-register'
        
        # Give Electron API server a brief second to launch on this secondary PC
        Start-Sleep -Seconds 1
        
        $res = Invoke-RestMethod -Uri $registerUrl -Method POST -Body $payload -ContentType "application/json" -TimeoutSec 10
        if ($res.success) {
            Write-OK "Successfully linked symmetrically with Main PC ($($res.hostname))!"
        } else {
            Write-Fail "Main PC rejected connection: $($res.error)"
        }
    }
    catch {
        Write-Host "  Could not pair with Main PC: $($_.Exception.Message)" -ForegroundColor Yellow
        Write-Host "  Please open the Synced app and check connection manually." -ForegroundColor Yellow
    }

    Write-Host ''
    Write-Host '  Setup completed successfully! ✓' -ForegroundColor Green
    Write-Host ''
}

Install-SyncedAndBridge
