@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0.."

REM ============================================================
REM  日志：所有外部命令输出同时上屏并写入 tools/update_server.log，
REM  便于出错后回看。改用纯 cmd 实现（不再依赖 powershell 管道），
REM  避免管道内 pause 失效导致的窗口闪退。
REM ============================================================
set "_LOG=%~dp0update_server.log"
set "_TMP=%TEMP%\update_server_tmp.txt"
echo ============================================================ > "%_LOG%"
echo  Gipfel server update started: %date% %time% >> "%_LOG%"
echo ============================================================ >> "%_LOG%"

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
call :run git --version
if errorlevel 1 (
    echo [FAIL] git not found. Install git first.
    goto :fail
)
call :run pm2 -v
if errorlevel 1 (
    set "PM2_OK=0"
    echo [WARN] PM2 not found. Skip start/stop; install with: npm install -g pm2
)

REM 友好提示：server/.env 不存在时 JWT_SECRET 等无法加载
if not exist "server\.env" (
    echo [WARN] server/.env 不存在：JWT_SECRET 等变量将无法加载，服务启动会失败。
    echo         请从 server/.env.example 复制为 .env 并填入 JWT_SECRET，或设置系统环境变量。
)

echo.
echo ============================================================
echo [2/8] Stopping server (pm2 stop gipfel-server) ...
echo ============================================================
if "!PM2_OK!"=="1" (
    call :run pm2 stop gipfel-server
    echo       Stopped.
)

echo.
echo ============================================================
echo [3/8] Pulling latest code (git pull) ...
echo ============================================================
call :run git pull
if errorlevel 1 (
    echo.
    echo [FAIL] git pull failed. Check network / local changes / conflicts.
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
call :run npm install
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
call :run npm run build
if errorlevel 1 (
    echo.
    echo [FAIL] server build failed.
    goto :fail
)

echo.
echo ============================================================
echo [7/8] Migrating database (prisma db push) ...
echo ============================================================
call :run npx prisma db push
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
    call :run pm2 restart gipfel-server
    if errorlevel 1 (
        call :run pm2 start dist\main.js --name gipfel-server
    )
    call :run pm2 save
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

:run
echo ------------------------------------------------------------ >> "%_LOG%"
echo [CMD] %* >> "%_LOG%"
call %* > "%_TMP%" 2>&1
set "_RC=%errorlevel%"
type "%_TMP%"
type "%_TMP%" >> "%_LOG%"
exit /b %_RC%
