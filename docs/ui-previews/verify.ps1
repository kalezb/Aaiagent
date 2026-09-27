$ErrorActionPreference = "Stop"

$root = $PSScriptRoot
$previewHtml = Get-Content -Raw -Encoding UTF8 (Join-Path $root "preview.html")
$previewCss = Get-Content -Raw -Encoding UTF8 (Join-Path $root "preview.css")
$previewJs = Get-Content -Raw -Encoding UTF8 (Join-Path $root "preview.js")
$indexHtml = Get-Content -Raw -Encoding UTF8 (Join-Path $root "index.html")

function Assert-PreviewCondition {
  param(
    [bool]$Condition,
    [string]$Message
  )

  if (-not $Condition) {
    throw "UI preview verification failed: $Message"
  }
}

function ConvertFrom-CodePoints {
  param([int[]]$Codes)
  return -join ($Codes | ForEach-Object { [char]$_ })
}

$consoleSubtitle = ConvertFrom-CodePoints @(0x63A7, 0x5236, 0x53F0)
$chatSync = ConvertFrom-CodePoints @(0x804A, 0x5929, 0x8BB0, 0x5F55, 0x540C, 0x6B65)
$messageReminder = ConvertFrom-CodePoints @(0x65B0, 0x6D88, 0x606F, 0x63D0, 0x9192)
$customerProfile = ConvertFrom-CodePoints @(0x5BA2, 0x6237, 0x8D44, 0x6599, 0x6C89, 0x6DC0)
$nightQuiet = ConvertFrom-CodePoints @(0x591C, 0x95F4, 0x4F4E, 0x6253, 0x6270)
$chatSyncDone = ConvertFrom-CodePoints @(0x804A, 0x5929, 0x8BB0, 0x5F55, 0x540C, 0x6B65, 0x5B8C, 0x6210)
$devicePermission = ConvertFrom-CodePoints @(0x624B, 0x673A, 0x8BBE, 0x5907, 0x6743, 0x9650)
$accessibilityNotice = ConvertFrom-CodePoints @(0x65E0, 0x969C, 0x788D, 0x901A, 0x77E5)
$batteryOptimization = ConvertFrom-CodePoints @(0x7535, 0x6C60, 0x4F18, 0x5316)
$recentActivity = ConvertFrom-CodePoints @(0x6700, 0x8FD1, 0x8FD0, 0x884C, 0x8BB0, 0x5F55)

Assert-PreviewCondition (Test-Path (Join-Path $root "preview.html")) "preview.html is missing"
Assert-PreviewCondition (Test-Path (Join-Path $root "preview.js")) "preview.js is missing"
Assert-PreviewCondition ($previewHtml -match '<h1>AI ') "the product title was not renamed"
Assert-PreviewCondition ($previewHtml -match "<p>$consoleSubtitle</p>") "the subtitle was not simplified"
Assert-PreviewCondition (($previewHtml | Select-String -Pattern 'data-hosting-button-label' -AllMatches).Matches.Count -eq 1) "hosting label must appear once"
Assert-PreviewCondition ($previewHtml -notmatch 'data-hosting-title') "duplicate hosting heading must not remain"
Assert-PreviewCondition ($previewHtml -match 'data-mode="full"') "full auto mode is missing"
Assert-PreviewCondition (($previewHtml | Select-String -Pattern 'data-platform=' -AllMatches).Matches.Count -eq 4) "four platform buttons are required"
Assert-PreviewCondition ($previewHtml -match 'data-platform="soul"') "Soul platform button is missing"
Assert-PreviewCondition ($previewHtml -match 'data-platform="qq"') "QQ platform button is missing"
Assert-PreviewCondition ($previewHtml -match 'data-platform="momo"') "Momo platform button is missing"
Assert-PreviewCondition ($previewHtml -match 'data-platform="lianxin"') "Lianxin platform button is missing"
Assert-PreviewCondition ($previewHtml -match 'data-persona-select') "persona dropdown is missing"
Assert-PreviewCondition ($previewHtml -notmatch 'persona-list') "expanded persona list must not remain"
Assert-PreviewCondition ($previewHtml -match [regex]::Escape($devicePermission)) "device permission toggle is missing"
Assert-PreviewCondition ($previewHtml -match [regex]::Escape($accessibilityNotice)) "accessibility notification toggle is missing"
Assert-PreviewCondition ($previewHtml -match [regex]::Escape($batteryOptimization)) "battery optimization toggle is missing"
Assert-PreviewCondition ($previewHtml -notmatch [regex]::Escape($recentActivity)) "recent activity section must not remain"
Assert-PreviewCondition ($previewHtml -notmatch 'activity-list') "activity list must not remain"
Assert-PreviewCondition ($previewHtml -match 'id="home-address"') "home address input is missing"
Assert-PreviewCondition ($previewHtml -match 'id="work-address"') "work address input is missing"
Assert-PreviewCondition ($previewHtml -match 'data-save-address') "address save control is missing"
Assert-PreviewCondition ($previewHtml -notmatch 'class="bottom-nav"') "single-page preview must not contain bottom navigation"
Assert-PreviewCondition ($previewHtml -notmatch [regex]::Escape($chatSync)) "chat sync must not be displayed"
Assert-PreviewCondition ($previewHtml -notmatch [regex]::Escape($messageReminder)) "message reminder must not be displayed"
Assert-PreviewCondition ($previewHtml -notmatch [regex]::Escape($customerProfile)) "customer profile management must not be displayed"
Assert-PreviewCondition ($previewHtml -notmatch [regex]::Escape($nightQuiet)) "quiet-hours management must not be displayed"
Assert-PreviewCondition ($previewHtml -notmatch [regex]::Escape($chatSyncDone)) "chat sync activity must not be displayed"
Assert-PreviewCondition ($previewCss -match 'body\[data-theme="sky"\]') "sky theme is missing"
Assert-PreviewCondition ($previewCss -notmatch 'data-theme="orange"') "orange theme must not remain in the preview"
Assert-PreviewCondition ($previewJs -match 'new Set\(\["sky"\]\)') "only the sky theme should be supported"
Assert-PreviewCondition ($previewJs -notmatch 'orange') "orange theme logic must not remain"
Assert-PreviewCondition (($indexHtml | Select-String -Pattern '<section class="gallery-card' -AllMatches).Matches.Count -eq 1) "gallery must show only the sky preview"
Assert-PreviewCondition ($indexHtml -notmatch 'orange') "gallery must not contain an orange preview"

$forbiddenUiText = @("DeepSeek", "OpenAI", "DASHBOARD_PASSWORD", "API Key", "API address")
foreach ($text in $forbiddenUiText) {
  Assert-PreviewCondition ($previewHtml -notmatch [regex]::Escape($text)) "preview UI exposes forbidden technical text: $text"
}

Write-Host "UI preview verification passed: sky-only single page, four platform buttons, persona dropdown, device permission toggles, editable addresses, and no activity section are intact."
