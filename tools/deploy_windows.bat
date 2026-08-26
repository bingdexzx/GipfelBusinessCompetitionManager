@echo off
setlocal enabledelayedexpansion
REM ============================================================
REM Gipfel server - one-click update (Windows Server)
REM Mirrors tools/deploy_debian.sh.
REM Flow (abort on any failure):
REM   1. check pm2 / git / node
REM   2. backup dev.db + uploads + .env -> tools/backups/gipfel-<ts>.zip
REM   3. pm2 stop gipfel-server
REM   4. git pull
REM   5. npm ci (fallback npm install)
REM   6. prisma db push (migrate schema)
REM   7. npm run build (shared + nest)
REM   8. pm2 restart/start + pm2 save
REM   9. health check /api/ping
REM Usage: cd repo && deploy_windows.bat
REM Note: pure ASCII (GBK codepage would mangle UTF-8).
REM ============================================================
cd /d "%~dp0.."
set "REPO=%CD%"
cd /d "%REPO%\server"
set "BACKUPDIR=%REPO%\tools\backups"
set "LOG=%REPO%\tools\deploy.log"
echo [%date% %time%] deploy start >> "%LOG%"

REM --- 1. prereq ---
where node >nul 2>&1 || (echo [ERR] node not found & exit /b 1)
where git  >nul 2>&1 || (echo [ERR] git not found & exit /b 1)
set "HAVE_PM2=0"
where pm2 >nul 2>&1 && set "HAVE_PM2=1"

REM --- 2. backup ---
if not exist "%BACKUPDIR%" mkdir "%BACKUPDIR%"
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss"') do set "TS=%%i"
set "OUT=%BACKUPDIR%\gipfel-%TS%.zip"
powershell -NoProfile -Command "$items=@('prisma/dev.db','uploads','.env')|Where-Object{Test-Path $_}; if($items.Count -gt 0){Compress-Archive -Path $items -DestinationPath '%OUT%' -Force; Write-Host ('[deploy] backed up: '+'%OUT%')}else{Write-Host '[deploy] nothing to backup'}"
echo [deploy] backup done >> "%LOG%"

REM --- 3. stop ---
if "%HAVE_PM2%"=="1" (
  call pm2 stop gipfel-server
)

REM --- 4. pull ---
echo [deploy] git pull ...
call git pull
if errorlevel 1 (echo [ERR] git pull failed & exit /b 1)

REM --- 5. install (npmmirror) ---
echo [deploy] npm ci ...
set "NPM_CONFIG_REGISTRY=https://registry.npmmirror.com"
if exist package-lock.json (call npm ci) else (call npm install)
if errorlevel 1 (echo [ERR] npm install failed & exit /b 1)

REM --- 6. migrate ---
echo [deploy] prisma db push ...
call npx prisma db push
if errorlevel 1 (echo [ERR] prisma db push failed & exit /b 1)

REM --- 7. build ---
echo [deploy] npm run build ...
call npm run build
if errorlevel 1 (echo [ERR] build failed & exit /b 1)

REM --- 8. restart ---
if "%HAVE_PM2%"=="1" (
  pm2 describe gipfel-server >nul 2>&1 && (call pm2 restart gipfel-server) || (call pm2 start ecosystem.config.js)
  call pm2 save
) else (
  echo [WARN] pm2 not installed; start manually: npm run start:prod
)

REM --- 9. health check ---
timeout /t 3 >nul
echo [deploy] health check /api/ping
curl.exe -fsS http://localhost:3000/api/ping >nul 2>&1
if errorlevel 1 (
  echo [ERR] health check failed. See pm2 logs gipfel-server
  echo [ERR] rollback: backup_windows.bat restore %OUT%
  exit /b 1
)
echo [OK] update done. backup: %OUT%
exit /b 0
