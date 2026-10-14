param(
    [string]$Serial = "",
    [switch]$Install,
    [string]$ApkPath = "android/app/build/outputs/apk/debug/app-debug.apk",
    [string]$OutputDir = "Alinshi/android-device-smoke"
)

$ErrorActionPreference = "Stop"

$adbBase = @()
if ($Serial.Trim()) {
    $adbBase = @("-s", $Serial.Trim())
}

function Invoke-Adb {
    param([string[]]$Arguments)
    $output = & adb @adbBase @Arguments 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "adb $($Arguments -join ' ') failed:`n$output"
    }
    return $output
}

function Get-ConnectedDevices {
    $lines = & adb devices
    return @(
        $lines |
            Select-Object -Skip 1 |
            Where-Object { $_ -match "^\S+\s+device$" } |
            ForEach-Object { ($_ -split "\s+")[0] }
    )
}

function Decode-Text {
    param([string]$Value)
    return [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Value))
}

$connected = Get-ConnectedDevices
if ($Serial.Trim()) {
    if ($connected -notcontains $Serial.Trim()) {
        throw "Requested device not found: $Serial"
    }
} elseif ($connected.Count -ne 1) {
    throw "Expected exactly one connected device, found $($connected.Count)."
}

if ($Install) {
    $resolvedApk = Resolve-Path -LiteralPath $ApkPath
    Invoke-Adb -Arguments @("install", "-r", $resolvedApk.Path) | Out-Null
}

$outputRoot = Join-Path (Get-Location) $OutputDir
New-Item -ItemType Directory -Force -Path $outputRoot | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"

Invoke-Adb -Arguments @("shell", "am", "start", "-W", "-n", "com.aaiagent/.MainActivity") | Out-Null
Start-Sleep -Seconds 3

$xmlLocal = Join-Path $outputRoot "window-$stamp.xml"
$pngLocal = Join-Path $outputRoot "screen-$stamp.png"
$xmlRemote = "/sdcard/aia-device-window-$stamp.xml"
$pngRemote = "/sdcard/aia-device-screen-$stamp.png"
Invoke-Adb -Arguments @("shell", "uiautomator", "dump", $xmlRemote) | Out-Null
Invoke-Adb -Arguments @("pull", $xmlRemote, $xmlLocal) | Out-Null
Invoke-Adb -Arguments @("shell", "screencap", "-p", $pngRemote) | Out-Null
Invoke-Adb -Arguments @("pull", $pngRemote, $pngLocal) | Out-Null
Invoke-Adb -Arguments @("shell", "rm", $xmlRemote, $pngRemote) | Out-Null

[xml]$window = Get-Content -LiteralPath $xmlLocal -Raw -Encoding UTF8
$visibleText = @(
    $window.SelectNodes("//node") |
        ForEach-Object {
            $text = [string]$_.text
            $description = [string]$_.'content-desc'
            if ($text) { $text }
            if ($description) { $description }
        }
) -join "`n"

$landmarks = @(
    "QUkg5omY566h5Yqp5omL",
    "5YWx5Lqr5Lq66K6+6LWE5paZ",
    "6K6+5aSH5LiO5a6J5YWo"
)
$landmarks = @($landmarks | ForEach-Object { Decode-Text $_ })
$foundLandmark = @($landmarks | Where-Object { $visibleText.Contains($_) })

if ($foundLandmark.Count -eq 0) {
    throw "Device smoke check failed. The dashboard landmarks were not found. Screenshot: $pngLocal"
}

Write-Output "Device smoke check passed."
Write-Output "Screenshot: $pngLocal"
Write-Output "Window dump: $xmlLocal"
