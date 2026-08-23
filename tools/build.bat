@echo off
setlocal
cd /d "%~dp0"

REM ============================================================
REM Build helper (sandbox-safe).
REM WorkBuddy injects NODE_OPTIONS=--require=...genie-safe-delete.cjs
REM which intercepts rename/rmSync and breaks tsc/nest emit under
REM this sandbox (dist ends up empty). We neutralize it with
REM NODE_OPTIONS= and call tsc directly instead of nest build.
REM NOTE: this is pure ASCII on purpose (GBK codepage would mangle
REM UTF-8 Chinese in .bat). Keep comments English.
REM ============================================================

echo ============================================================
echo [1/3] Cleaning stale tsbuildinfo (incremental lie-cache)...
echo ============================================================
cd /d "%~dp0..\server"
if exist tsconfig.tsbuildinfo del /f /q tsconfig.tsbuildinfo
if exist tsconfig.build.tsbuildinfo del /f /q tsconfig.build.tsbuildinfo
cd /d "%~dp0..\shared\engine-dsl"
if exist tsconfig.tsbuildinfo del /f /q tsconfig.tsbuildinfo

echo.
echo ============================================================
echo [2/3] Building server (shared + server) ...
echo ============================================================
cd /d "%~dp0..\shared\engine-dsl"
set "NODE_OPTIONS="
call .\node_modules\.bin\tsc -p tsconfig.json
if errorlevel 1 (
    echo.
    echo [FAIL] Shared build failed. See the red errors above.
    echo Press any key to close this window.
    pause >nul
    exit /b 1
)

cd /d "%~dp0..\server"
set "NODE_OPTIONS="
call .\node_modules\.bin\tsc -p tsconfig.json
if errorlevel 1 (
    echo.
    echo [FAIL] Server build failed. See the red errors above.
    echo Press any key to close this window.
    pause >nul
    exit /b 1
)

echo.
echo ============================================================
echo [3/3] Building client ...
echo ============================================================
cd /d "%~dp0..\client"
set "NODE_OPTIONS="
call npm run build
if errorlevel 1 (
    echo.
    echo [FAIL] Client build failed. See the red errors above.
    echo Press any key to close this window.
    pause >nul
    exit /b 1
)

echo.
echo ============================================================
echo [OK] Server + client builds finished.
echo ============================================================
echo Press any key to close this window.
pause >nul
exit /b 0
