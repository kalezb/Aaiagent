param(
    [string]$ProjectRoot = ""
)

$ErrorActionPreference = "Stop"
if (-not $ProjectRoot.Trim()) {
    $ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
} else {
    $ProjectRoot = (Resolve-Path -LiteralPath $ProjectRoot).Path
}

$failures = [System.Collections.Generic.List[string]]::new()
$manifestPath = Join-Path $ProjectRoot "android/app/src/main/AndroidManifest.xml"
$networkConfigPath = Join-Path $ProjectRoot "android/app/src/main/res/xml/network_security_config.xml"
$providerPath = Join-Path $ProjectRoot "android/app/src/main/java/com/aaiagent/xposed/InjectPcmProvider.kt"

function Require-Contains {
    param(
        [string]$Path,
        [string]$Needle,
        [string]$Message
    )
    if (-not (Test-Path -LiteralPath $Path)) {
        $failures.Add("Missing file: $Path")
        return
    }
    $text = Get-Content -LiteralPath $Path -Raw
    if (-not $text.Contains($Needle)) {
        $failures.Add($Message)
    }
}

Require-Contains $manifestPath 'android:allowBackup="false"' "Android backup is not disabled"
Require-Contains $manifestPath 'android:exported="false"' "No internal component is explicitly closed"
Require-Contains $networkConfigPath 'cleartextTrafficPermitted="false"' "Cleartext network traffic is not disabled"
Require-Contains $providerPath 'callerAllowed(ctx)' "PCM provider has no caller check"
Require-Contains $providerPath 'SOUL_PACKAGE = "cn.soulapp.android"' "PCM provider is not limited to Soul"

$manifest = [xml](Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8)
$android = "http://schemas.android.com/apk/res/android"
$namespaceManager = New-Object System.Xml.XmlNamespaceManager($manifest.NameTable)
$namespaceManager.AddNamespace("android", $android)
$expectedExported = @(
    "com.aaiagent.inject",
    ".MainActivity",
    ".service.AssistantAccessibilityService",
    ".service.NotificationListener",
    ".service.BootReceiver"
)
$actualExported = @(
    $manifest.SelectNodes("//*[@android:exported='true']", $namespaceManager) |
        ForEach-Object {
            $name = ($_.Attributes | Where-Object { $_.Name -eq "android:name" }).Value
            $authority = ($_.Attributes | Where-Object { $_.Name -eq "android:authorities" }).Value
            if ($authority) { $authority } else { $name }
        }
)
foreach ($name in $actualExported) {
    if ($expectedExported -notcontains $name) {
        $failures.Add("Unexpected exported component: $name")
    }
}

$secretFiles = @(
    ".dev.vars",
    ".env",
    ".env.local",
    "backend/.dev.vars",
    "android/keystore.properties"
)
foreach ($relative in $secretFiles) {
    $path = Join-Path $ProjectRoot $relative
    if (Test-Path -LiteralPath $path) {
        $relativeLower = $relative.ToLowerInvariant()
        if (-not $relativeLower.Contains("example") -and
            -not $relativeLower.Contains("sample")) {
            $failures.Add("Possible local secret file: $relative")
        }
    }
}

if ($failures.Count -gt 0) {
    Write-Output "Security audit failed:"
    $failures | ForEach-Object { Write-Output " - $_" }
    exit 1
}

Write-Output "Security audit passed."
Write-Output "Exported components: $($actualExported -join ', ')"
