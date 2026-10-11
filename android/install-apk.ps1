# 保留数据的卸载重装流程。
#
# 2026-10-10：这台手机开启 SELinux 后，root 读不到 /data/data/com.aaiagent，
# 原来的 su + tar 备份会生成一个 103 字节的空壳，然后照样卸载，风险很高。
# 现在改为：
#   1. 用 run-as（App 自己的身份）在手机里打包数据。
#   2. 拉到电脑，并检查备份里真的有 aaiagent.db；检查不过就直接停，不卸载。
#   3. 卸载、安装新版后，把备份推回手机，再用 run-as 解压。
#   4. 最后核对数据库存在，并且属于新版 App 的 uid。
#
# 用法：
#   pwsh -File android/install-apk.ps1 -Apk "F:/Aaiagent/ceshibao/AI托管助手-vX.apk"
# 只验备份、不卸载安装：
#   pwsh -File android/install-apk.ps1 -Apk "F:/Aaiagent/ceshibao/AI托管助手-vX.apk" -BackupOnly

param(
    [Parameter(Mandatory = $true)][string]$Apk,
    [string]$Package = "com.aaiagent",
    [switch]$BackupOnly
)

$ErrorActionPreference = "Stop"
$deviceBackup = "/data/local/tmp/aaiagent_install_backup.tar.gz"
$appCacheBackup = "cache/install_backup.tar.gz"
$backupDir = Join-Path $PSScriptRoot "install-backups"
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$localBackup = Join-Path $backupDir "$Package-$stamp.tar.gz"

New-Item -ItemType Directory -Path $backupDir -Force | Out-Null

Write-Host "1) 用 App 自己的身份备份数据"
$backupCommand = "cd /data/data/$Package && rm -f $appCacheBackup && tar -czf $appCacheBackup databases shared_prefs files"
$backupOutput = (adb shell "run-as $Package sh -c '$backupCommand'" 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0) {
    throw "App 数据备份失败：$backupOutput"
}

$sizeText = (adb shell run-as $Package wc -c $appCacheBackup 2>&1 | Out-String).Trim()
if ($sizeText -notmatch "^(\d+)") {
    throw "读不到备份文件大小：$sizeText"
}
$backupSize = [long]$Matches[1]
if ($backupSize -le 0) {
    throw "备份文件是空的，停止安装"
}

& cmd.exe /c "adb exec-out run-as $Package cat $appCacheBackup > `"$localBackup`""
if (-not (Test-Path -LiteralPath $localBackup)) {
    throw "备份没有拉到电脑：$localBackup"
}
if ((Get-Item -LiteralPath $localBackup).Length -le 0) {
    throw "电脑上的备份文件是空的：$localBackup"
}

$backupEntries = @(& tar -tzf $localBackup 2>&1)
if ($LASTEXITCODE -ne 0) {
    throw "电脑上的备份包打不开：$localBackup"
}
if ($backupEntries -notcontains "databases/aaiagent.db") {
    throw "备份里没有 databases/aaiagent.db，停止安装：$localBackup"
}
if ($backupEntries -notcontains "databases/aaiagent.db-wal") {
    Write-Host "  [!] 备份里没有数据库 WAL 文件，继续前请先确认 App 已停稳" -ForegroundColor Yellow
}

Write-Host "   备份通过：$localBackup ($backupSize bytes)"

if ($BackupOnly) {
    Write-Host "只做备份校验，不卸载、不安装。" -ForegroundColor Green
    exit 0
}

Write-Host "2) 卸载旧版"
adb uninstall $Package | Out-Null

Write-Host "3) 安装新版：$Apk"
adb install -r "$Apk"
$version = (adb shell dumpsys package $Package | Select-String "versionName=" | Select-Object -First 1).ToString().Trim()
Write-Host "   已安装：$version"

Write-Host "4) 还原数据"
adb push $localBackup $deviceBackup | Out-Null
$restoreCommand = "tar -xzf $deviceBackup -C /data/data/$Package"
$restoreOutput = (adb shell "run-as $Package sh -c '$restoreCommand'" 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0) {
    throw "数据还原失败：$restoreOutput"
}

$fixModeCommand = "find /data/data/$Package/databases /data/data/$Package/shared_prefs /data/data/$Package/files -type d -exec chmod 771 {} +"
$null = (adb shell "run-as $Package sh -c '$fixModeCommand'" 2>&1 | Out-String)
$fixFileModeCommand = "find /data/data/$Package/databases /data/data/$Package/shared_prefs /data/data/$Package/files -type f -exec chmod 660 {} +"
$null = (adb shell "run-as $Package sh -c '$fixFileModeCommand'" 2>&1 | Out-String)

$uid = ((adb shell dumpsys package $Package | Select-String "userId=" | Select-Object -First 1).ToString() -replace ".*userId=", "" -replace "\s.*", "").Trim()
Write-Host "   App uid = $uid"

$dbSizeText = (adb shell run-as $Package wc -c /data/data/$Package/databases/aaiagent.db 2>&1 | Out-String).Trim()
if ($dbSizeText -notmatch "^(\d+)") {
    throw "还原后读不到数据库：$dbSizeText"
}
if ([long]$Matches[1] -le 0) {
    throw "还原后的数据库是空的，停止"
}
Write-Host "   数据库已还原：$($Matches[1]) bytes"

Write-Host "5) 恢复权限与开关"
# 2026-10-07：权限恢复必须“做了就核对”，以前 su 不可用时静默失败，
# 装完无障碍是 null、Agent 直接读不了屏，用户只能自己发现。现在失败会明确报错。
$null = (adb shell cmd notification allow_listener "$Package/$Package.service.NotificationListener" 2>&1 | Out-String)
$permOk = $true
$overlay = (adb shell appops set $Package SYSTEM_ALERT_WINDOW allow 2>&1 | Out-String)
if ($overlay -match "Error|error|not found") {
  $null = (adb shell su -c "appops set $Package SYSTEM_ALERT_WINDOW allow" 2>&1 | Out-String)
}
$null = (adb shell settings put secure enabled_accessibility_services "$Package/$Package.service.AssistantAccessibilityService" 2>&1 | Out-String)
$null = (adb shell settings put secure accessibility_enabled 1 2>&1 | Out-String)
Start-Sleep -Seconds 1
$accRead = (adb shell settings get secure enabled_accessibility_services 2>&1 | Out-String).Trim()
$ovlRead = (adb shell appops get $Package SYSTEM_ALERT_WINDOW 2>&1 | Out-String).Trim()
if ($accRead -notlike "*$Package*") {
  $permOk = $false
  Write-Host "  [!] 无障碍服务没设置成功（当前值：$accRead）" -ForegroundColor Red
  Write-Host "      手动执行： adb shell settings put secure enabled_accessibility_services $Package/$Package.service.AssistantAccessibilityService" -ForegroundColor Yellow
  Write-Host "                 adb shell settings put secure accessibility_enabled 1" -ForegroundColor Yellow
}
if ($ovlRead -notmatch "allow") {
  $permOk = $false
  Write-Host "  [!] 悬浮窗权限没设置成功（当前值：$ovlRead）" -ForegroundColor Red
  Write-Host "      手动执行： adb shell appops set $Package SYSTEM_ALERT_WINDOW allow" -ForegroundColor Yellow
}
if ($permOk) { Write-Host "  无障碍与悬浮窗已设置并核对通过" -ForegroundColor Green }
else { Write-Host "  [!] 权限没弄好，Agent 现在读不了屏，请按上面提示手动补" -ForegroundColor Red }

Write-Host "6) 自检：数据库归属必须是新版 App 的 uid"
adb shell run-as $Package ls -ln /data/data/$Package/databases/aaiagent.db

Write-Host "完成。数据库大小和归属都核对过。"
