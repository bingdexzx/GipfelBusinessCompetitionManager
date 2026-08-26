@echo off
setlocal enabledelayedexpansion
REM ============================================================
REM Gipfel server - backup / restore (Windows Server)
REM Mirrors tools/backup_debian.sh.
REM Usage:
REM   backup_windows.bat                (backup)
REM   backup_windows.bat restore <zip>  (restore)
REM Backup = prisma/dev.db + uploads + .env -> tools/backups/gipfel-<ts>.zip
REM Note: pure ASCII (GBK codepage would mangle UTF-8).
REM ============================================================
cd /d "%~dp0.."
set "REPO=%CD%"
cd /d "%REPO%\server"
set "BACKUPDIR=%REPO%\tools\backups"

if /i "%~1"=="restore" (
  set "SRC=%~2"
  if "%SRC%"=="" (echo [ERR] usage: backup_windows.bat restore ^<zip^> & exit /b 1)
  if not exist "%SRC%" (echo [ERR] backup not found: %SRC% & exit /b 1)
  where pm2 >nul 2>&1 && pm2 describe gipfel-server >nul 2>&1 (
    echo [WARN] gipfel-server is running.
    set /p "ANS=Stop PM2 and restore from %SRC%? (y/N): "
    if /i "!ANS!"=="y" (call pm2 stop gipfel-server)
  )
  powershell -NoProfile -Command "Expand-Archive -Path '%SRC%' -DestinationPath '%REPO%\server' -Force"
  echo [backup] restored from %SRC%
  exit /b 0
)

REM backup mode
if not exist "%BACKUPDIR%" mkdir "%BACKUPDIR%"
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss"') do set "TS=%%i"
set "OUT=%BACKUPDIR%\gipfel-%TS%.zip"
powershell -NoProfile -Command "$items=@('prisma/dev.db','uploads','.env')|Where-Object{Test-Path $_}; if($items.Count -gt 0){Compress-Archive -Path $items -DestinationPath '%OUT%' -Force; Write-Host ('[backup] done: '+'%OUT%')}else{Write-Host '[backup] nothing to backup'}"
exit /b 0
