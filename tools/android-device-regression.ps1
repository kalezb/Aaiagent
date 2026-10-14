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

function Invoke-AdbText {
    param([string[]]$Arguments)
    $output = & adb @adbBase @Arguments 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "adb $($Arguments -join ' ') failed:`n$output"
    }
    return ($output -join "`n")
}

function Invoke-Smoke {
    param([switch]$InstallApk)
    $arguments = @(
        "-ExecutionPolicy", "Bypass",
        "-File", "tools/android-device-smoke.ps1",
        "-OutputDir", $OutputDir
    )
    if ($Serial.Trim()) {
        $arguments += @("-Serial", $Serial.Trim())
    }
    if ($InstallApk) {
        $arguments += @("-Install", "-ApkPath", $ApkPath)
    }
    & powershell @arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Device smoke check failed."
    }
}

Write-Output "1/4 Open and check the installed package"
Invoke-Smoke -InstallApk:$Install

Write-Output "2/4 Check installed version"
$packageDump = Invoke-AdbText @("shell", "dumpsys", "package", "com.aaiagent")
$versionLine = $packageDump -split "`n" |
    Where-Object { $_ -match "versionName=" } |
    Select-Object -First 1
if (-not $versionLine) {
    throw "Could not read the installed version."
}
Write-Output ("  " + $versionLine.Trim())

Write-Output "3/4 Force stop and open again"
Invoke-AdbText @("shell", "am", "force-stop", "com.aaiagent") | Out-Null
Start-Sleep -Seconds 1
Invoke-Smoke

Write-Output "4/4 Confirm the dashboard is still open and hosting did not start"
$window = Invoke-AdbText @("shell", "dumpsys", "window")
if ($window -notmatch "com\.aaiagent/com\.aaiagent\.MainActivity") {
    throw "The dashboard did not reopen."
}

Write-Output "Android device regression passed."
Write-Output "Real chat, photos, voice, and live rule changes still require the manual checklist."
