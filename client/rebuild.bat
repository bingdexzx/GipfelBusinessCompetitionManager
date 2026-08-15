@echo off
setlocal
REM ============================================================
REM  Rollback Electron to 33.x + install + build (China mirror)
REM
REM  Prerequisite: package.json already has "electron": "^33.0.0".
REM  Run this in a REAL terminal (double-click, or run from cmd).
REM  Do NOT run it inside the AI sandbox.
REM ============================================================
cd /d "%~dp0"

echo.
echo [0/4] Check electron version in package.json ...
findstr /C:"electron" package.json

echo.
echo [1/4] Setting China mirrors ...
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
set ELECTRON_CUSTOM_DIR={{ version }}
set npm_config_registry=https://registry.npmmirror.com

echo.
echo [2/4] Pinning electron to 33.x and installing deps ...
call npm install electron@^33.0.0 --save-dev --no-audit --no-fund
if errorlevel 1 goto :error

call npm install --no-audit --no-fund
if errorlevel 1 goto :error

echo.
echo [3/4] Building client (vue-tsc + vite build) ...
call npm run build
if errorlevel 1 goto :error

echo.
echo [4/4] Cleaning temp npm cache left by the sandbox (if any) ...
if exist "..\.npm-cache-tmp" rmdir /s /q "..\.npm-cache-tmp" 2>nul

echo.
echo ============================================================
echo  DONE. Restart the Electron client to verify the stock page.
echo ============================================================
pause
exit /b 0

:error
echo.
echo ============================================================
echo  FAILED. See the error message above.
echo ============================================================
pause
exit /b 1
