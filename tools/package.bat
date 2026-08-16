@echo off
setlocal
cd /d "%~dp0"

REM ============================================================
REM  Package the Electron client into a Windows (win32) NSIS
REM  installer. All downloads use China (npmmirror) mirrors to
REM  avoid GitHub timeouts.
REM
REM  Output: client\release\Gipfel Setup <version>.exe
REM ============================================================

REM --- China mirrors ---
REM npm registry mirror (speed up npm install / dependency fetch)
set "NPM_CONFIG_REGISTRY=https://registry.npmmirror.com"
REM Electron prebuilt binary mirror
set "ELECTRON_MIRROR=https://cdn.npmmirror.com/binaries/electron/"
REM electron-builder side binaries (winCodeSign / nsis / nsis-resources / ...)
REM NOTE: the variable is ELECTRON_BUILDER_BINARIES_MIRROR (with "ARIES"),
REM       NOT ELECTRON_BUILDER_BIN_MIRROR.
set "ELECTRON_BUILDER_BINARIES_MIRROR=https://cdn.npmmirror.com/binaries/electron-builder-binaries/"

REM Node trusts the system CA store (required behind TLS-intercepting
REM proxies with a private root CA). Needs Node 24+.
set "NODE_OPTIONS=--use-system-ca"

echo ============================================================
echo [1/1] Building client (vite) + win32 NSIS installer ...
echo ============================================================
cd /d "%~dp0..\client"
call npm run electron:build
if errorlevel 1 (
    echo.
    echo [FAIL] Packaging failed. See the red errors above.
    echo Press any key to close this window.
    pause >nul
    exit /b 1
)

echo.
echo ============================================================
echo [OK] win32 installer built. Output folder: client\release
echo ============================================================
echo Press any key to close this window.
pause >nul
exit /b 0
