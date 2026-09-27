$ErrorActionPreference = "Stop"

$root = $PSScriptRoot
$previewHtml = Get-Content -Raw (Join-Path $root "preview.html")
$previewCss = Get-Content -Raw (Join-Path $root "preview.css")
$previewJs = Get-Content -Raw (Join-Path $root "preview.js")
$indexHtml = Get-Content -Raw (Join-Path $root "index.html")

function Assert-PreviewCondition {
  param(
    [bool]$Condition,
    [string]$Message
  )

  if (-not $Condition) {
    throw "UI preview verification failed: $Message"
  }
}

Assert-PreviewCondition (Test-Path (Join-Path $root "preview.html")) "preview.html is missing"
Assert-PreviewCondition (Test-Path (Join-Path $root "preview.js")) "preview.js is missing"
Assert-PreviewCondition ($previewHtml -match 'data-hosting-toggle') "hosting master toggle is missing"
Assert-PreviewCondition ($previewHtml -match 'data-mode="full"') "full auto mode is missing"
Assert-PreviewCondition ($previewHtml -match 'data-persona="xingmu"') "persona selector is missing"
Assert-PreviewCondition ($previewHtml -match 'data-switch-row') "row-level toggle controls are missing"
Assert-PreviewCondition ($previewHtml -match 'data-mode-hint') "today mode hint is missing"
Assert-PreviewCondition ($previewHtml -notmatch 'class="bottom-nav"') "single-page preview must not contain bottom navigation"
Assert-PreviewCondition ($previewCss -match 'body\[data-theme="sky"\]') "sky theme is missing"
Assert-PreviewCondition ($previewCss -match 'body\[data-theme="orange"\]') "orange theme is missing"
Assert-PreviewCondition ($previewJs -match 'new Set\(\["sky", "orange"\]\)') "only sky and orange themes should be supported"
Assert-PreviewCondition ($previewJs -match 'hosting = requestedHosting') "hosted-state preview parameter is missing"
Assert-PreviewCondition (($indexHtml | Select-String -Pattern '<section class="gallery-card' -AllMatches).Matches.Count -eq 2) "gallery must show exactly two preview themes"

$forbiddenUiText = @("DeepSeek", "OpenAI", "DASHBOARD_PASSWORD", "API Key", "API address")
foreach ($text in $forbiddenUiText) {
  Assert-PreviewCondition ($previewHtml -notmatch [regex]::Escape($text)) "preview UI exposes forbidden technical text: $text"
}

Write-Host "UI preview verification passed: single page, two themes, toggles, and hidden technical details are intact."
