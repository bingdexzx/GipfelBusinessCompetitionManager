@echo off
setlocal
cd /d "%~dp0"

echo ============================================================
echo [1/2] Building server ...
echo ============================================================
cd /d "%~dp0server"
call npm run build
if errorlevel 1 (
    echo.
    echo [FAIL] Server build failed. See the red errors above.
    echo Press any key to close this window.
    pause >nul
    exit /b 1
)

echo.
echo ============================================================
echo [2/2] Building client ...
echo ============================================================
cd /d "%~dp0client"
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
