@echo off
setlocal
cd /d "%~dp0"

REM Use npmmirror to speed up Electron / electron-builder binary downloads (avoid GitHub timeouts).
REM To use the default registry instead, delete the two SET lines below.
REM To route all npm packages through npmmirror too, add: set "NPM_CONFIG_REGISTRY=https://registry.npmmirror.com"
set "ELECTRON_MIRROR=https://cdn.npmmirror.com/binaries/electron/"
set "ELECTRON_BUILDER_BINARIES_MIRROR=https://cdn.npmmirror.com/binaries/electron-builder-binaries/"

echo ============================================================
echo [1/3] Installing server dependencies ...
echo ============================================================
cd /d "%~dp0server"
if exist package-lock.json del package-lock.json
if exist node_modules rmdir /s /q node_modules
call npm install
if errorlevel 1 (
    echo.
    echo [FAIL] Server npm install failed. See the red errors above.
    echo Press any key to close this window.
    pause >nul
    exit /b 1
)

echo.
echo ============================================================
echo [2/3] Regenerating Prisma client (v6) ...
echo ============================================================
call npm run prisma:generate
if errorlevel 1 (
    echo.
    echo [WARN] prisma generate failed. If the error is an EPERM on query_engine rename,
    echo        delete node_modules/.prisma/client/*.tmp* and retry: npm run prisma:generate
)

echo.
echo ============================================================
echo [3/3] Installing client dependencies ...
echo ============================================================
cd /d "%~dp0client"
if exist package-lock.json del package-lock.json
if exist node_modules rmdir /s /q node_modules
call npm install
if errorlevel 1 (
    echo.
    echo [FAIL] Client npm install failed. See the red errors above.
    echo Press any key to close this window.
    pause >nul
    exit /b 1
)

echo.
echo ============================================================
echo [OK] Dependencies installed.
echo      If this is a fresh clone (DB not initialized), continue with:
echo        cd server ^&^& npx prisma db push ^&^& npx prisma db seed
echo      Then run start_server.bat and start_client.bat.
echo      Remember to commit the regenerated package-lock.json files.
echo ============================================================
echo Press any key to close this window.
pause >nul
exit /b 0
