param(
    [string]$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
)

$ErrorActionPreference = "Stop"
$rootPath = (Resolve-Path -LiteralPath $Root).Path
Set-Location -LiteralPath $rootPath

function Get-TreeSize {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return 0 }
    return (Get-ChildItem -LiteralPath $Path -Recurse -File -ErrorAction SilentlyContinue |
        Measure-Object Length -Sum).Sum
}

function Format-MB {
    param([double]$Bytes)
    return [math]::Round($Bytes / 1MB, 2)
}

Write-Host "Repository: $rootPath"
Write-Host ""

$tracked = @(git ls-files)
$trackedBytes = 0
$trackedRows = foreach ($file in $tracked) {
    if (-not (Test-Path -LiteralPath $file)) { continue }
    $item = Get-Item -LiteralPath $file
    $trackedBytes += $item.Length
    [pscustomobject]@{
        MB = Format-MB $item.Length
        Path = $file
    }
}

$migrations = @(Get-ChildItem -LiteralPath (Join-Path $rootPath "backend/db/migrations") -File -ErrorAction SilentlyContinue)
$commitCount = [int](git rev-list --all --count)

Write-Host "Summary"
Write-Host "  Tracked files:       $($tracked.Count)"
Write-Host "  Tracked size:        $(Format-MB $trackedBytes) MB"
Write-Host "  Git commits:         $commitCount"
Write-Host "  DB migrations:       $($migrations.Count)"
Write-Host "  Android worktree:    $(Format-MB (Get-TreeSize (Join-Path $rootPath 'android'))) MB"
Write-Host "  Backend worktree:    $(Format-MB (Get-TreeSize (Join-Path $rootPath 'backend'))) MB"
Write-Host "  APK archive folder:  $(Format-MB (Get-TreeSize (Join-Path $rootPath 'ceshibao'))) MB"
Write-Host ""

Write-Host "Largest tracked files"
$trackedRows | Sort-Object MB -Descending | Select-Object -First 30 | Format-Table -AutoSize
Write-Host ""

Write-Host "Largest working files outside node_modules/.git/build caches"
Get-ChildItem -LiteralPath $rootPath -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object {
        $_.FullName -notmatch "\\node_modules\\|\\.git\\|\\.gradle\\|\\build\\|\\.wrangler\\"
    } |
    Sort-Object Length -Descending |
    Select-Object -First 30 @{N = "MB"; E = { Format-MB $_.Length } }, FullName |
    Format-Table -AutoSize

Write-Host ""
Write-Host "Tracked build or binary output that should normally stay out of Git"
$suspicious = $tracked | Where-Object {
    $_ -match "(^|/)(build|dist|\.gradle)/" -or
    $_ -match "\.(apk|aab|dex|class|hprof)$"
}
if ($suspicious.Count) {
    $suspicious | ForEach-Object { Write-Host "  $_" }
} else {
    Write-Host "  None"
}
