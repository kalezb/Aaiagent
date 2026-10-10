param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("Start", "Stop", "Status", "Worker")]
    [string]$Action,

    [string]$OutputRoot = "F:\Aaiagent\logs\agent_monitor",
    [string]$SessionDir = "",
    [string]$PackageName = "com.aaiagent",
    [int]$IntervalSeconds = 10
)

$ErrorActionPreference = "Stop"

function Get-AdbState {
    try {
        return (adb get-state 2>$null | Select-Object -First 1).Trim()
    } catch {
        return "missing"
    }
}

function Get-ExpectedVersion {
    $gradle = "F:\Aaiagent\android\app\build.gradle.kts"
    $line = Get-Content $gradle | Select-String 'versionName' | Select-Object -First 1
    if ($null -eq $line) { return "" }
    return (($line.Line -replace '.*"([^"]+)".*', '$1')).Trim()
}

function Get-InstalledVersion {
    $line = adb shell dumpsys package $PackageName 2>$null |
        Select-String 'versionName=' |
        Select-Object -First 1
    if ($null -eq $line) { return "" }
    return $line.Line.Trim()
}

function Get-AccessibilityState {
    return (adb shell settings get secure enabled_accessibility_services 2>$null |
        Select-Object -First 1).Trim()
}

function Get-ForegroundPackage {
    $line = adb shell dumpsys activity activities 2>$null |
        Select-String 'mResumedActivity' |
        Select-Object -First 1
    if ($null -eq $line) { return "" }
    $text = $line.Line
    if ($text -match 'u0\s+([^/]+)/') { return $matches[1] }
    return $text.Trim()
}

function Append-JsonLine {
    param([string]$Path, [hashtable]$Value)
    ($Value | ConvertTo-Json -Compress -Depth 6) | Add-Content -LiteralPath $Path -Encoding utf8
}

function Add-Alert {
    param(
        [string]$SessionDir,
        [string]$Kind,
        [string]$Message
    )
    Add-Content -LiteralPath (Join-Path $SessionDir "alerts.log") `
        -Encoding utf8 `
        -Value ("[{0}] {1} | {2}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Kind, $Message)
}

function Start-Worker {
    New-Item -ItemType Directory -Force -Path $OutputRoot | Out-Null
    $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $session = Join-Path $OutputRoot $timestamp
    New-Item -ItemType Directory -Force -Path $session | Out-Null

    $pwsh = (Get-Command pwsh -ErrorAction SilentlyContinue).Source
    if ([string]::IsNullOrWhiteSpace($pwsh)) {
        $pwsh = (Get-Command powershell -ErrorAction Stop).Source
    }
    $script = $PSCommandPath
    $arguments = @(
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", $script,
        "-Action", "Worker",
        "-OutputRoot", $OutputRoot,
        "-SessionDir", $session,
        "-PackageName", $PackageName,
        "-IntervalSeconds", $IntervalSeconds
    )
    $process = Start-Process -FilePath $pwsh `
        -ArgumentList $arguments `
        -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $session "worker.out.log") `
        -RedirectStandardError (Join-Path $session "worker.err.log") `
        -PassThru

    Set-Content -LiteralPath (Join-Path $OutputRoot "current_session.txt") `
        -Value $session `
        -Encoding utf8
    Set-Content -LiteralPath (Join-Path $OutputRoot "monitor.pid") `
        -Value $process.Id `
        -Encoding ascii
    Write-Output "MONITOR_STARTED session=$session pid=$($process.Id)"
}

function Stop-Worker {
    $pidPath = Join-Path $OutputRoot "monitor.pid"
    $sessionPath = Join-Path $OutputRoot "current_session.txt"
    if (Test-Path -LiteralPath $sessionPath) {
        $session = (Get-Content -LiteralPath $sessionPath -Raw).Trim()
        if ($session -and (Test-Path -LiteralPath $session)) {
            Set-Content -LiteralPath (Join-Path $session "stop.requested") `
                -Value (Get-Date -Format "yyyy-MM-dd HH:mm:ss") `
                -Encoding utf8
        }
    }
    if (Test-Path -LiteralPath $pidPath) {
        $workerPid = [int]((Get-Content -LiteralPath $pidPath -Raw).Trim())
        Stop-Process -Id $workerPid -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue
    }
    Write-Output "MONITOR_STOPPED"
}

function Show-Status {
    $sessionPath = Join-Path $OutputRoot "current_session.txt"
    $pidPath = Join-Path $OutputRoot "monitor.pid"
    if (!(Test-Path -LiteralPath $sessionPath) -or !(Test-Path -LiteralPath $pidPath)) {
        Write-Output "MONITOR_NOT_RUNNING"
        return
    }
    $session = (Get-Content -LiteralPath $sessionPath -Raw).Trim()
    $workerPid = [int]((Get-Content -LiteralPath $pidPath -Raw).Trim())
    $running = $null -ne (Get-Process -Id $workerPid -ErrorAction SilentlyContinue)
    Write-Output "MONITOR_RUNNING=$running session=$session pid=$workerPid"
    $alerts = Join-Path $session "alerts.log"
    if (Test-Path -LiteralPath $alerts) {
        Get-Content -LiteralPath $alerts | Select-Object -Last 20
    }
}

function Run-Worker {
    if ([string]::IsNullOrWhiteSpace($SessionDir)) {
        throw "SessionDir is required for Worker action"
    }
    New-Item -ItemType Directory -Force -Path $SessionDir | Out-Null
    $eventsPath = Join-Path $SessionDir "events.jsonl"
    $statePath = Join-Path $SessionDir "state.jsonl"
    $journalPath = Join-Path $SessionDir "journal.log"
    $alertsPath = Join-Path $SessionDir "alerts.log"
    $stopPath = Join-Path $SessionDir "stop.requested"
    $expectedVersion = Get-ExpectedVersion

    $seenLogs = @{}
    $seenJournal = @{}
    $pendingClick = $null
    $pendingRead = $null
    $roundTimes = New-Object System.Collections.Generic.List[datetime]

    $logPattern = 'FATAL EXCEPTION|ANR in com\.aaiagent|Process com\.aaiagent.*(died|killed)|E/AIA|W/AIA|D/AIA'
    $journalWatch = '状态变化|点进会话|读消息|发消息|点错页面|恢复|失败|异常|无法|重试|超时|卡死|崩溃'

    Append-JsonLine $eventsPath @{
        time = (Get-Date -Format "yyyy-MM-dd HH:mm:ss")
        event = "monitor_started"
        expectedVersion = $expectedVersion
    }

    while (!(Test-Path -LiteralPath $stopPath)) {
        $now = Get-Date
        $adbState = Get-AdbState
        $appPid = (adb shell pidof $PackageName 2>$null | Select-Object -First 1)
        $accessibility = Get-AccessibilityState
        $installedVersion = Get-InstalledVersion
        $foreground = Get-ForegroundPackage

        Append-JsonLine $statePath @{
            time = $now.ToString("yyyy-MM-dd HH:mm:ss")
            adb = $adbState
            pid = $appPid
            accessibility = $accessibility
            installedVersion = $installedVersion
            foreground = $foreground
        }

        if ($adbState -ne "device") {
            Add-Alert $SessionDir "DEVICE" "adb state=$adbState"
        }
        if ([string]::IsNullOrWhiteSpace($appPid)) {
            Add-Alert $SessionDir "PROCESS" "com.aaiagent process is missing"
        }
        if ($accessibility -notmatch [regex]::Escape("$PackageName/com.aaiagent.service.AssistantAccessibilityService")) {
            Add-Alert $SessionDir "ACCESSIBILITY" "service disabled: $accessibility"
        }
        if ($installedVersion -and $expectedVersion -and $installedVersion -notmatch [regex]::Escape($expectedVersion)) {
            Add-Alert $SessionDir "VERSION" "installed=$installedVersion expected=$expectedVersion"
        }

        foreach ($line in ((adb logcat -d -v time -t 1500 2>$null) | Select-String -Pattern $logPattern)) {
            $text = $line.Line
            if ($seenLogs.ContainsKey($text)) { continue }
            $seenLogs[$text] = $true
            if ($text -match 'FATAL EXCEPTION|ANR in com\.aaiagent|Process com\.aaiagent.*(died|killed)') {
                Add-Alert $SessionDir "CRASH" $text
            }
            if ($text -match 'hosting loop stopped|lease state=EXPIRED|chat_slow') {
                Add-Alert $SessionDir "RUNTIME" $text
            }
            Append-JsonLine $eventsPath @{
                time = $now.ToString("yyyy-MM-dd HH:mm:ss")
                event = "logcat"
                text = $text
            }
            if ($text -match 'message-list round complete') {
                $roundTimes.Add($now)
                $roundTimes.RemoveAll({ param($x) ($now - $x).TotalSeconds -gt 15 })
                if ($roundTimes.Count -ge 6) {
                    Add-Alert $SessionDir "SPIN" "message-list round repeated $($roundTimes.Count) times within 15 seconds"
                    $roundTimes.Clear()
                }
            }
        }

        $journal = adb shell run-as $PackageName cat files/journal/runtime_journal.txt 2>$null
        foreach ($line in ($journal | Select-String -Pattern $journalWatch)) {
            $text = $line.Line
            if ($seenJournal.ContainsKey($text)) { continue }
            $seenJournal[$text] = $true
            Append-JsonLine $eventsPath @{
                time = $now.ToString("yyyy-MM-dd HH:mm:ss")
                event = "journal"
                text = $text
            }
            if ($text -match '点进会话 \| 成功 \| 联系人=(.+)$') {
                $contact = $matches[1].Trim()
                $pendingClick = @{ contact = $contact; at = $now }
            }
            if ($text -match '状态变化 \| Idle → ReadingMessages') {
                $pendingClick = $null
            }
            if ($text -match '读消息 \| 读到') {
                $pendingRead = @{ at = $now; text = $text }
            }
            if ($text -match '发消息 \| 成功') {
                $pendingRead = $null
            }
            if ($text -match '失败|异常|无法|点错|重试|超时|卡死|崩溃') {
                Add-Alert $SessionDir "JOURNAL" $text
            }
        }
        if ($null -ne $pendingClick -and ($now - $pendingClick.at).TotalSeconds -gt 20) {
            Add-Alert $SessionDir "STUCK_CLICK" "no reading state after click contact=$($pendingClick.contact)"
            $pendingClick = $null
        }
        if ($null -ne $pendingRead -and ($now - $pendingRead.at).TotalSeconds -gt 35) {
            Add-Alert $SessionDir "STUCK_SEND" "read but no send after 35 seconds: $($pendingRead.text)"
            $pendingRead = $null
        }

        if ($seenLogs.Count -gt 8000) { $seenLogs.Clear() }
        if ($seenJournal.Count -gt 5000) { $seenJournal.Clear() }
        Start-Sleep -Seconds ([Math]::Max(3, $IntervalSeconds))
    }

    Append-JsonLine $eventsPath @{
        time = (Get-Date -Format "yyyy-MM-dd HH:mm:ss")
        event = "monitor_stopped"
    }
}

switch ($Action) {
    "Start" { Start-Worker }
    "Stop" { Stop-Worker }
    "Status" { Show-Status }
    "Worker" { Run-Worker }
}
