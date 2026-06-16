#Requires -Version 5.1
<#
.SYNOPSIS
    Synced Bridge Server — HTTP listener for secondary PC remote management.
.DESCRIPTION
    Exposes a REST API on the secondary PC that allows the primary PC to:
    - Execute PowerShell commands
    - Read/write/transfer files (including base64 binary transfer)
    - Query system specs and processes
    - Kill/launch processes
    - Shutdown/restart/sleep the machine
    All endpoints require Bearer token authentication.
.NOTES
    Version: 1.0.0
    Author:  Synced
#>

param(
    [int]$Port = 8765,
    [string]$ConfigPath = (Join-Path $PSScriptRoot 'config.json'),
    [string]$LogPath    = (Join-Path $PSScriptRoot 'synced-bridge.log'),
    [string]$SpecsCache = (Join-Path $PSScriptRoot 'system-cache.json')
)

# ── Strict mode ──────────────────────────────────────────────────────────────
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ── Globals ──────────────────────────────────────────────────────────────────
$script:Version   = '1.0.0'
$script:StartTime = [datetime]::UtcNow
$script:Listener  = $null
$script:Running   = $true

# ══════════════════════════════════════════════════════════════════════════════
#  LOGGING
# ══════════════════════════════════════════════════════════════════════════════

function Write-Log {
    param(
        [string]$Message,
        [ValidateSet('INFO','WARN','ERROR','DEBUG')]
        [string]$Level = 'INFO'
    )
    $timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    $entry = "[$timestamp] [$Level] $Message"

    # Console output with colour
    switch ($Level) {
        'ERROR' { Write-Host $entry -ForegroundColor Red }
        'WARN'  { Write-Host $entry -ForegroundColor Yellow }
        'DEBUG' { Write-Host $entry -ForegroundColor DarkGray }
        default { Write-Host $entry -ForegroundColor Cyan }
    }

    # Append to log file (fire-and-forget to avoid blocking)
    try { $entry | Out-File -FilePath $LogPath -Append -Encoding utf8 } catch {}
}

# ══════════════════════════════════════════════════════════════════════════════
#  CONFIGURATION
# ══════════════════════════════════════════════════════════════════════════════

function Initialize-Config {
    <#
    .SYNOPSIS  Load or create config.json with a unique bearer token.
    #>
    if (Test-Path $ConfigPath) {
        try {
            $cfg = Get-Content $ConfigPath -Raw | ConvertFrom-Json
            if ([string]::IsNullOrWhiteSpace($cfg.token)) { throw 'Empty token' }
            Write-Log "Config loaded from $ConfigPath"
            return $cfg
        }
        catch {
            Write-Log "Existing config is invalid, regenerating. Error: $_" -Level WARN
        }
    }

    # Generate a cryptographically-random 64-char hex token
    $bytes = New-Object byte[] 32
    $rng   = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $rng.GetBytes($bytes)
    $token = ($bytes | ForEach-Object { $_.ToString('x2') }) -join ''
    $rng.Dispose()

    $cfg = [ordered]@{
        token     = $token
        port      = $Port
        createdAt = (Get-Date -Format 'o')
    }
    $cfg | ConvertTo-Json -Depth 4 | Set-Content $ConfigPath -Encoding utf8
    Write-Log "New config generated and saved to $ConfigPath"
    return [PSCustomObject]$cfg
}

# ══════════════════════════════════════════════════════════════════════════════
#  HTTP HELPERS
# ══════════════════════════════════════════════════════════════════════════════

function Send-JsonResponse {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [object]$Body,
        [int]$StatusCode = 200
    )
    $json = $Body | ConvertTo-Json -Depth 10 -Compress
    $buffer = [System.Text.Encoding]::UTF8.GetBytes($json)

    $Response.StatusCode  = $StatusCode
    $Response.ContentType = 'application/json; charset=utf-8'
    $Response.ContentLength64 = $buffer.Length

    # CORS headers
    $Response.Headers.Add('Access-Control-Allow-Origin', '*')
    $Response.Headers.Add('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    $Response.Headers.Add('Access-Control-Allow-Headers', 'Authorization, Content-Type')

    $Response.OutputStream.Write($buffer, 0, $buffer.Length)
    $Response.OutputStream.Close()
}

function Send-ErrorResponse {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [string]$Message,
        [int]$StatusCode = 500
    )
    $body = @{ error = $true; message = $Message }
    Send-JsonResponse -Response $Response -Body $body -StatusCode $StatusCode
}

function Read-RequestBody {
    param([System.Net.HttpListenerRequest]$Request)
    $reader = New-Object System.IO.StreamReader($Request.InputStream, $Request.ContentEncoding)
    $raw    = $reader.ReadToEnd()
    $reader.Close()
    if ([string]::IsNullOrWhiteSpace($raw)) { return $null }
    return $raw | ConvertFrom-Json
}

function Test-Auth {
    <#
    .SYNOPSIS  Validate Bearer token from Authorization header.
    #>
    param(
        [System.Net.HttpListenerRequest]$Request,
        [string]$ExpectedToken
    )
    $authHeader = $Request.Headers['Authorization']
    if ([string]::IsNullOrWhiteSpace($authHeader)) { return $false }
    if (-not $authHeader.StartsWith('Bearer ', [System.StringComparison]::OrdinalIgnoreCase)) { return $false }
    $provided = $authHeader.Substring(7).Trim()
    return ($provided -ceq $ExpectedToken)
}

# ══════════════════════════════════════════════════════════════════════════════
#  ENDPOINT HANDLERS
# ══════════════════════════════════════════════════════════════════════════════

# ── GET /status ──────────────────────────────────────────────────────────────
function Handle-Status {
    param([System.Net.HttpListenerResponse]$Response)
    $uptime = [math]::Round(([datetime]::UtcNow - $script:StartTime).TotalSeconds)
    $body = [ordered]@{
        service  = 'synced-bridge'
        hostname = $env:COMPUTERNAME
        version  = $script:Version
        uptime   = $uptime
        os       = [System.Environment]::OSVersion.VersionString
    }
    Send-JsonResponse -Response $Response -Body $body
}

# ── POST /exec ───────────────────────────────────────────────────────────────
function Handle-Exec {
    param(
        [System.Net.HttpListenerRequest]$Request,
        [System.Net.HttpListenerResponse]$Response
    )
    $data = Read-RequestBody -Request $Request
    if (-not $data -or [string]::IsNullOrWhiteSpace($data.command)) {
        Send-ErrorResponse -Response $Response -Message 'Missing "command" in request body.' -StatusCode 400
        return
    }

    $command = $data.command
    Write-Log "EXEC: $command"

    $output   = ''
    $errText  = ''
    $exitCode = 0

    try {
        # Run in a child powershell to isolate state
        $result = powershell.exe -NoProfile -NonInteractive -Command $command 2>&1
        $exitCode = $LASTEXITCODE
        if ($null -eq $exitCode) { $exitCode = 0 }

        # Separate stdout from stderr
        $stdOut = @()
        $stdErr = @()
        foreach ($line in $result) {
            if ($line -is [System.Management.Automation.ErrorRecord]) {
                $stdErr += $line.ToString()
            } else {
                $stdOut += $line.ToString()
            }
        }
        $output  = $stdOut -join "`n"
        $errText = $stdErr -join "`n"
    }
    catch {
        $errText  = $_.Exception.Message
        $exitCode = 1
    }

    $body = [ordered]@{
        output   = $output
        error    = $errText
        exitCode = $exitCode
    }
    Send-JsonResponse -Response $Response -Body $body
}

# ── POST /read ───────────────────────────────────────────────────────────────
function Handle-ReadFile {
    param(
        [System.Net.HttpListenerRequest]$Request,
        [System.Net.HttpListenerResponse]$Response
    )
    $data = Read-RequestBody -Request $Request
    if (-not $data -or [string]::IsNullOrWhiteSpace($data.path)) {
        Send-ErrorResponse -Response $Response -Message 'Missing "path" in request body.' -StatusCode 400
        return
    }

    $filePath = $data.path
    Write-Log "READ: $filePath"

    if (-not (Test-Path $filePath)) {
        Send-ErrorResponse -Response $Response -Message "File not found: $filePath" -StatusCode 404
        return
    }

    try {
        $content = Get-Content $filePath -Raw -Encoding utf8
        $body = @{ content = $content; path = $filePath; size = (Get-Item $filePath).Length }
        Send-JsonResponse -Response $Response -Body $body
    }
    catch {
        Send-ErrorResponse -Response $Response -Message "Failed to read file: $($_.Exception.Message)"
    }
}

# ── POST /write ──────────────────────────────────────────────────────────────
function Handle-WriteFile {
    param(
        [System.Net.HttpListenerRequest]$Request,
        [System.Net.HttpListenerResponse]$Response
    )
    $data = Read-RequestBody -Request $Request
    if (-not $data -or [string]::IsNullOrWhiteSpace($data.path)) {
        Send-ErrorResponse -Response $Response -Message 'Missing "path" in request body.' -StatusCode 400
        return
    }

    $filePath = $data.path
    Write-Log "WRITE: $filePath"

    try {
        $dir = Split-Path $filePath -Parent
        if (-not (Test-Path $dir)) {
            New-Item -ItemType Directory -Path $dir -Force | Out-Null
        }
        $data.content | Set-Content $filePath -Encoding utf8 -Force
        $body = @{ success = $true; path = $filePath }
        Send-JsonResponse -Response $Response -Body $body
    }
    catch {
        Send-ErrorResponse -Response $Response -Message "Failed to write file: $($_.Exception.Message)"
    }
}

# ── GET /specs ───────────────────────────────────────────────────────────────
function Handle-Specs {
    param([System.Net.HttpListenerResponse]$Response)
    Write-Log 'SPECS requested'

    try {
        # Try to read from cache first (written by synced-agent.ps1)
        if ((Test-Path $SpecsCache) -and ((Get-Item $SpecsCache).LastWriteTime -gt (Get-Date).AddMinutes(-2))) {
            $cached = Get-Content $SpecsCache -Raw | ConvertFrom-Json
            Send-JsonResponse -Response $Response -Body $cached
            return
        }

        # Fallback: collect live
        $cpu  = Get-CimInstance Win32_Processor | Select-Object -First 1
        $os   = Get-CimInstance Win32_OperatingSystem
        $gpu  = Get-CimInstance Win32_VideoController | Select-Object -First 1
        $disks = Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" |
                 ForEach-Object {
                     [ordered]@{
                         drive     = $_.DeviceID
                         totalGB   = [math]::Round($_.Size / 1GB, 2)
                         freeGB    = [math]::Round($_.FreeSpace / 1GB, 2)
                         usedPct   = if ($_.Size -gt 0) { [math]::Round((($_.Size - $_.FreeSpace) / $_.Size) * 100, 1) } else { 0 }
                     }
                 }

        $body = [ordered]@{
            hostname = $env:COMPUTERNAME
            os       = "$($os.Caption) $($os.Version)"
            cpu      = [ordered]@{
                model       = $cpu.Name.Trim()
                cores       = $cpu.NumberOfCores
                threads     = $cpu.NumberOfLogicalProcessors
                maxClockMHz = $cpu.MaxClockSpeed
            }
            ram      = [ordered]@{
                totalGB     = [math]::Round($os.TotalVisibleMemorySize / 1MB, 2)
                availableGB = [math]::Round($os.FreePhysicalMemory / 1MB, 2)
            }
            gpu      = [ordered]@{
                model  = if ($gpu) { $gpu.Name } else { 'N/A' }
                vramMB = if ($gpu -and $gpu.AdapterRAM) { [math]::Round($gpu.AdapterRAM / 1MB) } else { 0 }
                driver = if ($gpu) { $gpu.DriverVersion } else { 'N/A' }
            }
            disks    = @($disks)
        }
        Send-JsonResponse -Response $Response -Body $body
    }
    catch {
        Send-ErrorResponse -Response $Response -Message "Failed to collect specs: $($_.Exception.Message)"
    }
}

# ── GET /processes ───────────────────────────────────────────────────────────
function Handle-Processes {
    param([System.Net.HttpListenerResponse]$Response)
    Write-Log 'PROCESSES requested'

    try {
        $procs = Get-Process -ErrorAction SilentlyContinue |
                 Where-Object { $_.Id -ne 0 } |
                 Sort-Object CPU -Descending |
                 Select-Object -First 100 |
                 ForEach-Object {
                     [ordered]@{
                         pid    = $_.Id
                         name   = $_.ProcessName
                         cpu    = [math]::Round($_.CPU, 2)
                         memory = [math]::Round($_.WorkingSet64 / 1MB, 2)
                         path   = try { $_.Path } catch { '' }
                     }
                 }

        $body = @{ processes = @($procs); count = ($procs | Measure-Object).Count }
        Send-JsonResponse -Response $Response -Body $body
    }
    catch {
        Send-ErrorResponse -Response $Response -Message "Failed to list processes: $($_.Exception.Message)"
    }
}

# ── POST /kill ───────────────────────────────────────────────────────────────
function Handle-Kill {
    param(
        [System.Net.HttpListenerRequest]$Request,
        [System.Net.HttpListenerResponse]$Response
    )
    $data = Read-RequestBody -Request $Request
    if (-not $data -or -not $data.pid) {
        Send-ErrorResponse -Response $Response -Message 'Missing "pid" in request body.' -StatusCode 400
        return
    }

    $targetPid = [int]$data.pid
    Write-Log "KILL PID: $targetPid" -Level WARN

    try {
        $proc = Get-Process -Id $targetPid -ErrorAction Stop
        $procName = $proc.ProcessName
        Stop-Process -Id $targetPid -Force -ErrorAction Stop
        $body = @{ success = $true; killed = $procName; pid = $targetPid }
        Send-JsonResponse -Response $Response -Body $body
    }
    catch {
        Send-ErrorResponse -Response $Response -Message "Failed to kill PID $targetPid`: $($_.Exception.Message)"
    }
}

# ── POST /launch ─────────────────────────────────────────────────────────────
function Handle-Launch {
    param(
        [System.Net.HttpListenerRequest]$Request,
        [System.Net.HttpListenerResponse]$Response
    )
    $data = Read-RequestBody -Request $Request
    if (-not $data -or [string]::IsNullOrWhiteSpace($data.path)) {
        Send-ErrorResponse -Response $Response -Message 'Missing "path" in request body.' -StatusCode 400
        return
    }

    $exePath = $data.path
    $exeArgs = if ($data.args) { $data.args } else { '' }
    Write-Log "LAUNCH: $exePath $exeArgs"

    if (-not (Test-Path $exePath)) {
        Send-ErrorResponse -Response $Response -Message "Executable not found: $exePath" -StatusCode 404
        return
    }

    try {
        $startInfo = @{ FilePath = $exePath; PassThru = $true }
        if (-not [string]::IsNullOrWhiteSpace($exeArgs)) {
            $startInfo['ArgumentList'] = $exeArgs
        }
        $proc = Start-Process @startInfo
        $body = @{ success = $true; pid = $proc.Id; name = $proc.ProcessName }
        Send-JsonResponse -Response $Response -Body $body
    }
    catch {
        Send-ErrorResponse -Response $Response -Message "Failed to launch: $($_.Exception.Message)"
    }
}

# ── POST /shutdown ───────────────────────────────────────────────────────────
function Handle-Shutdown {
    param(
        [System.Net.HttpListenerRequest]$Request,
        [System.Net.HttpListenerResponse]$Response
    )
    $data = Read-RequestBody -Request $Request
    if (-not $data -or [string]::IsNullOrWhiteSpace($data.action)) {
        Send-ErrorResponse -Response $Response -Message 'Missing "action" in request body. Expected: shutdown, restart, or sleep.' -StatusCode 400
        return
    }

    $action = $data.action.ToLower()
    Write-Log "POWER ACTION: $action" -Level WARN

    # Send response BEFORE executing the action
    $body = @{ success = $true; action = $action }
    Send-JsonResponse -Response $Response -Body $body

    Start-Sleep -Seconds 1

    switch ($action) {
        'shutdown' { Stop-Computer -Force }
        'restart'  { Restart-Computer -Force }
        'sleep'    {
            Add-Type -AssemblyName System.Windows.Forms
            [System.Windows.Forms.Application]::SetSuspendState('Suspend', $false, $false)
        }
        default {
            Write-Log "Unknown power action: $action" -Level ERROR
        }
    }
}

# ── POST /transfer ───────────────────────────────────────────────────────────
function Handle-Transfer {
    param(
        [System.Net.HttpListenerRequest]$Request,
        [System.Net.HttpListenerResponse]$Response
    )
    $data = Read-RequestBody -Request $Request
    if (-not $data -or [string]::IsNullOrWhiteSpace($data.path) -or [string]::IsNullOrWhiteSpace($data.content)) {
        Send-ErrorResponse -Response $Response -Message 'Missing "path" and/or "content" in request body.' -StatusCode 400
        return
    }

    $filePath = $data.path
    $encoding = if ($data.encoding) { $data.encoding } else { 'base64' }
    Write-Log "TRANSFER: $filePath (encoding=$encoding)"

    try {
        $dir = Split-Path $filePath -Parent
        if (-not (Test-Path $dir)) {
            New-Item -ItemType Directory -Path $dir -Force | Out-Null
        }

        if ($encoding -eq 'base64') {
            $bytes = [System.Convert]::FromBase64String($data.content)
            [System.IO.File]::WriteAllBytes($filePath, $bytes)
        }
        else {
            $data.content | Set-Content $filePath -Encoding utf8 -Force
        }

        $fileInfo = Get-Item $filePath
        $body = @{ success = $true; path = $filePath; sizeBytes = $fileInfo.Length }
        Send-JsonResponse -Response $Response -Body $body
    }
    catch {
        Send-ErrorResponse -Response $Response -Message "Transfer failed: $($_.Exception.Message)"
    }
}

# ══════════════════════════════════════════════════════════════════════════════
#  REQUEST ROUTER
# ══════════════════════════════════════════════════════════════════════════════

function Invoke-RequestRouter {
    param(
        [System.Net.HttpListenerContext]$Context,
        [string]$Token
    )

    $request  = $Context.Request
    $response = $Context.Response
    $method   = $request.HttpMethod
    $path     = $request.Url.AbsolutePath.TrimEnd('/')

    # ── Handle CORS preflight ────────────────────────────────────────────
    if ($method -eq 'OPTIONS') {
        $response.StatusCode = 204
        $response.Headers.Add('Access-Control-Allow-Origin', '*')
        $response.Headers.Add('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        $response.Headers.Add('Access-Control-Allow-Headers', 'Authorization, Content-Type')
        $response.Headers.Add('Access-Control-Max-Age', '86400')
        $response.OutputStream.Close()
        return
    }

    # ── Authenticate ─────────────────────────────────────────────────────
    if (-not (Test-Auth -Request $request -ExpectedToken $Token)) {
        Write-Log "Unauthorized request from $($request.RemoteEndPoint) -> $method $path" -Level WARN
        Send-ErrorResponse -Response $response -Message 'Unauthorized. Provide a valid Bearer token.' -StatusCode 401
        return
    }

    $clientIP = $request.RemoteEndPoint.Address.ToString()
    Write-Log "$method $path from $clientIP"

    # ── Route to handler ─────────────────────────────────────────────────
    try {
        switch ("$method $path") {
            'GET /status'      { Handle-Status    -Response $response }
            'GET /specs'       { Handle-Specs     -Response $response }
            'GET /processes'   { Handle-Processes -Response $response }
            'POST /exec'      { Handle-Exec      -Request $request -Response $response }
            'POST /read'      { Handle-ReadFile   -Request $request -Response $response }
            'POST /write'     { Handle-WriteFile  -Request $request -Response $response }
            'POST /kill'      { Handle-Kill       -Request $request -Response $response }
            'POST /launch'    { Handle-Launch     -Request $request -Response $response }
            'POST /shutdown'  { Handle-Shutdown   -Request $request -Response $response }
            'POST /transfer'  { Handle-Transfer   -Request $request -Response $response }
            default {
                Send-ErrorResponse -Response $response -Message "Unknown endpoint: $method $path" -StatusCode 404
            }
        }
    }
    catch {
        Write-Log "Unhandled error on $method $path`: $($_.Exception.Message)" -Level ERROR
        try { Send-ErrorResponse -Response $response -Message "Internal server error: $($_.Exception.Message)" } catch {}
    }
}

# ══════════════════════════════════════════════════════════════════════════════
#  MAIN — SERVER LOOP
# ══════════════════════════════════════════════════════════════════════════════

function Start-BridgeServer {
    # ── Banner ────────────────────────────────────────────────────────────
    Write-Host ''
    Write-Host '  ╔══════════════════════════════════════════╗' -ForegroundColor Magenta
    Write-Host '  ║                                          ║' -ForegroundColor Magenta
    Write-Host '  ║         SYNCED BRIDGE SERVER  v1.0.0     ║' -ForegroundColor Magenta
    Write-Host '  ║                                          ║' -ForegroundColor Magenta
    Write-Host '  ╚══════════════════════════════════════════╝' -ForegroundColor Magenta
    Write-Host ''

    # ── Load config ───────────────────────────────────────────────────────
    $config = Initialize-Config
    $token  = $config.token

    # Use port from config if available, otherwise use param default
    if ($config.port) { $Port = $config.port }

    # ── Start listener ────────────────────────────────────────────────────
    $prefix = "http://+:$Port/"
    $script:Listener = New-Object System.Net.HttpListener
    $script:Listener.Prefixes.Add($prefix)

    try {
        $script:Listener.Start()
    }
    catch {
        Write-Log "Failed to start listener on $prefix — Try running as Administrator." -Level ERROR
        Write-Log "Error: $($_.Exception.Message)" -Level ERROR
        return
    }

    # Get local IP for display
    $localIP = (Get-NetIPAddress -AddressFamily IPv4 |
                Where-Object { $_.InterfaceAlias -notmatch 'Loopback' -and $_.IPAddress -ne '127.0.0.1' } |
                Select-Object -First 1).IPAddress

    Write-Host "  Listening on  : http://$($localIP):$Port/" -ForegroundColor Green
    Write-Host "  Hostname      : $env:COMPUTERNAME" -ForegroundColor Green
    Write-Host "  Token         : $($token.Substring(0,8))..." -ForegroundColor Green
    Write-Host "  Log file      : $LogPath" -ForegroundColor Green
    Write-Host "  Config        : $ConfigPath" -ForegroundColor Green
    Write-Host ''
    Write-Host '  Press Ctrl+C to stop the server.' -ForegroundColor DarkGray
    Write-Host '  ──────────────────────────────────────────' -ForegroundColor DarkGray
    Write-Host ''

    Write-Log "Bridge server started on port $Port"

    # ── Register clean shutdown ───────────────────────────────────────────
    $null = Register-EngineEvent -SourceIdentifier PowerShell.Exiting -Action {
        $script:Running = $false
    }

    [Console]::TreatControlCAsInput = $false

    # ── Request loop ──────────────────────────────────────────────────────
    try {
        while ($script:Listener.IsListening -and $script:Running) {
            # Use async GetContext with a timeout so Ctrl+C can interrupt
            $contextTask = $script:Listener.GetContextAsync()

            while (-not $contextTask.AsyncWaitHandle.WaitOne(500)) {
                if (-not $script:Running) { break }
            }

            if (-not $script:Running) { break }

            if ($contextTask.IsCompleted) {
                $context = $contextTask.Result
                Invoke-RequestRouter -Context $context -Token $token
            }
        }
    }
    catch [System.OperationCanceledException] {
        # Expected on shutdown
    }
    catch {
        if ($script:Running) {
            Write-Log "Server loop error: $($_.Exception.Message)" -Level ERROR
        }
    }
    finally {
        Write-Log 'Shutting down bridge server...'
        try {
            $script:Listener.Stop()
            $script:Listener.Close()
        } catch {}
        Write-Log 'Bridge server stopped.'
        Write-Host ''
        Write-Host '  Bridge server stopped.' -ForegroundColor Yellow
    }
}

# ── Entry point ──────────────────────────────────────────────────────────────
Start-BridgeServer
