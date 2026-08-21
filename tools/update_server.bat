@echo off
setlocal enabledelayedexpansion

REM ============================================================
REM  输出同时上屏并写入日志，便于出错后回看（PowerShell Tee-Object）。
REM  若系统无 powershell，或 powershell 调用失败（如执行策略受限），
REM  则退化为直接运行（不写日志），脚本依然可用且不闪退。
REM ============================================================
if not defined _TEED (
  set "_TEED=1"
  set "_BAT=%~f0"
  set "_LOG=%~dp0update_server.log"
  where powershell >nul 2>&1
  if not errorlevel 1 (
    powershell -NoProfile -Command "cmd /c $env:_BAT 2>&1 | Tee-Object -FilePath $env:_LOG"
    if errorlevel 1 (
      REM 管道命令调用失败（如执行策略受限），直接运行主体（不写日志但仍可排障）
      call "%~f0"
    )
  ) else (
    call "%~f0"
  )
  goto :eof
)

cd /d "%~dp0.."

REM ============================================================
REM  Gipfel server one-click update (deploy to production host)
REM
REM  Steps:
REM    1. check prerequisites (git / pm2)
REM    2. stop PM2  (gipfel-server)
REM    3. git pull
REM    4. backup SQLite db
REM    5. npm install (server)
REM    6. npm run build (shared + nest)
REM    7. prisma db push (migrate schema)
REM    8. pm2 restart / start
REM
REM  Requires: git, Node.js + npm, PM2.
REM  PM2 first-time setup: cd server ^&^& pm2 start dist/main.js --name gipfel-server
REM ============================================================

REM China mirror (delete this line to use the default npm registry)
set "NPM_CONFIG_REGISTRY=https://registry.npmmirror.com"

echo ============================================================
echo [1/8] Checking prerequisites (git / pm2) ...
echo ============================================================
set "PM2_OK=1"
git --version >nul 2>&1
if errorlevel 1 (
    echo [FAIL] git not found. Install git first.
    goto :fail
)
pm2 -v >nul 2>&1
if errorlevel 1 (
    set "PM2_OK=0"
    echo [WARN] PM2 not found. Skip start/stop; install with: npm install -g pm2
)

echo.
echo ============================================================
echo [2/8] Stopping server (pm2 stop gipfel-server) ...
echo ============================================================
if "!PM2_OK!"=="1" (
    pm2 stop gipfel-server
    echo       Stopped.
)

echo.
echo ============================================================
echo [3/8] Pulling latest code (git pull) ...
echo ============================================================
git pull
if errorlevel 1 (
    echo.
    echo [FAIL] git pull failed. Check for local changes or conflicts.
    goto :fail
)

echo.
echo ============================================================
echo [4/8] Backing up database ...
echo ============================================================
if exist "server\prisma\dev.db" (
    copy /y "server\prisma\dev.db" "server\prisma\dev.db.bak" >nul
    echo       Saved to server\prisma\dev.db.bak
) else (
    echo       No dev.db found, skip.
)

echo.
echo ============================================================
echo [5/8] Installing dependencies (server) ...
echo ============================================================
cd /d "%~dp0..\server"
call npm install
if errorlevel 1 (
    echo.
    echo [FAIL] server npm install failed.
    goto :fail
)

echo.
echo ============================================================
echo [6/8] Building server (shared + nest build) ...
echo ============================================================
cd /d "%~dp0..\server"
call npm run build
if errorlevel 1 (
    echo.
    echo [FAIL] server build failed.
    goto :fail
)

echo.
echo ============================================================
echo [7/8] Migrating database (prisma db push) ...
echo ============================================================
call npx prisma db push
if errorlevel 1 (
    echo.
    echo [WARN] prisma db push failed. If EPERM on query_engine:
    echo        cd server ^&^& npx prisma generate
)

echo.
echo ============================================================
echo [8/8] Restarting server (PM2) ...
echo ============================================================
if "!PM2_OK!"=="1" (
    pm2 restart gipfel-server
    if errorlevel 1 (
        pm2 start dist\main.js --name gipfel-server
    )
    pm2 save
    echo       Server restarted via PM2.
) else (
    echo       PM2 not installed. Start manually: cd server ^&^& npm run start:prod
)

echo.
echo ============================================================
echo [OK] Update finished. Health check:
echo      curl http://localhost:3000/api/ping
echo ============================================================
echo 本次运行日志已保存至：tools\update_server.log
echo Press any key to close this window.
pause >nul
exit /b 0

:fail
echo.
echo ============================================================
echo [ABORT] Update aborted. If the server was stopped, restart:
echo         pm2 restart gipfel-server
echo ============================================================
echo 错误详情见日志：tools\update_server.log（与脚本同目录）
echo Press any key to close this window.
pause
exit /b 1
