param(
    [string]$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
    [string]$Destination = "F:\Aaiagent_artifacts\workspace-archive-20261009",
    [switch]$Apply
)

$ErrorActionPreference = "Stop"
$rootPath = (Resolve-Path -LiteralPath $Root).Path
$destinationPath = [System.IO.Path]::GetFullPath($Destination)

if (-not $destinationPath.StartsWith("F:\Aaiagent_artifacts\", [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Destination must stay under F:\Aaiagent_artifacts\"
}

$candidates = @(
    (Join-Path $rootPath "ceshibao"),
    (Join-Path $rootPath "android/app/build"),
    (Join-Path $rootPath "android/build")
)
$rootApks = @(Get-ChildItem -LiteralPath $rootPath -File -Filter "*.apk" -ErrorAction SilentlyContinue)

$items = @()
foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate) {
        $resolved = (Resolve-Path -LiteralPath $candidate).Path
        if (-not $resolved.StartsWith($rootPath + "\", [System.StringComparison]::OrdinalIgnoreCase)) {
            throw "Candidate escaped the project root: $resolved"
        }
        $items += Get-Item -LiteralPath $resolved
    }
}
$items += $rootApks

if (-not $items.Count) {
    Write-Host "Nothing to archive."
    exit 0
}

$totalBytes = 0
foreach ($item in $items) {
    if ($item.PSIsContainer) {
        $totalBytes += (Get-ChildItem -LiteralPath $item.FullName -Recurse -File -ErrorAction SilentlyContinue |
            Measure-Object Length -Sum).Sum
    } else {
        $totalBytes += $item.Length
    }
}

Write-Host "Archive target: $destinationPath"
Write-Host "Will move $($items.Count) item(s), about $([math]::Round($totalBytes / 1MB, 2)) MB:"
$items | ForEach-Object { Write-Host "  $($_.FullName)" }

if (-not $Apply) {
    Write-Host ""
    Write-Host "Dry run only. Re-run with -Apply to move these items."
    exit 0
}

New-Item -ItemType Directory -Path $destinationPath -Force | Out-Null
foreach ($item in $items) {
    $target = Join-Path $destinationPath $item.Name
    if (Test-Path -LiteralPath $target) {
        $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
        $target = "$target-$stamp"
    }
    Move-Item -LiteralPath $item.FullName -Destination $target
    Write-Host "Moved: $($item.FullName) -> $target"
}

Write-Host ""
Write-Host "Archive complete."
