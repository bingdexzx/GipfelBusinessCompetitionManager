@echo off
setlocal
cd /d "%~dp0"

REM Use the npmmirror (China) mirror to speed up downloading Electron / NSIS build deps.
REM Direct GitHub downloads often time out and break packaging. Successful downloads are cached locally.
set "ELECTRON_MIRROR=https://cdn.npmmirror.com/binaries/electron/"
REM NOTE: electron-builder's binary mirror var is ELECTRON_BUILDER_BINARIES_MIRROR (with "ARIES"),
REM not ELECTRON_BUILDER_BIN_MIRROR. It covers winCodeSign / nsis / nsis-resources and all build deps.
set "ELECTRON_BUILDER_BINARIES_MIRROR=https://cdn.npmmirror.com/binaries/electron-builder-binaries/"

REM Node only trusts its bundled CA store by default and ignores the Windows system cert store.
REM Behind a TLS-intercepting proxy (self-signed / private CA), downloads fail with
REM "unable to verify the first certificate" even via the npmmirror mirror.
REM --use-system-ca makes Node trust the system cert store (incl. the proxy root CA). Needs Node 24+.
set "NODE_OPTIONS=--use-system-ca"

echo ============================================================
echo [1/1] Building install package (client + NSIS installer) ...
echo ============================================================
cd /d "%~dp0..\client"
call npm run electron:build
if errorlevel 1 (
    echo.
    echo [FAIL] Install package build failed. See the red errors above.
    echo Press any key to close this window.
    pause >nul
    exit /b 1
)

echo.
echo ============================================================
echo [OK] Install package built. Output folder: client/release
echo ============================================================
echo Press any key to close this window.
pause >nul
exit /b 0
