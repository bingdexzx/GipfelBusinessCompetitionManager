@echo off
setlocal
cd /d "%~dp0"

REM 使用国内镜像（npmmirror）加速 Electron / NSIS 等构建依赖的下载；
REM 直连 GitHub 常超时导致打包失败。下载成功后会缓存在本地，后续不再重复下载。
set "ELECTRON_MIRROR=https://cdn.npmmirror.com/binaries/electron/"
REM 注意：electron-builder 二进制镜像变量名是 ELECTRON_BUILDER_BINARIES_MIRROR（含 ARIES），
REM 不是 ELECTRON_BUILDER_BIN_MIRROR。它覆盖 winCodeSign / nsis / nsis-resources 等所有构建依赖。
set "ELECTRON_BUILDER_BINARIES_MIRROR=https://cdn.npmmirror.com/binaries/electron-builder-binaries/"

REM Node 默认只用自带 CA 库、不读 Windows 系统证书库。若网络经 TLS 拦截代理（自签/私有 CA），
REM 即便走 npmmirror 镜像，下载 Electron/NSIS 等依赖时仍会 "unable to verify the first certificate"。
REM --use-system-ca 让 Node 信任系统证书库（含代理根证书），构建下载即可通过（Node 24 支持）。
set "NODE_OPTIONS=--use-system-ca"

echo ============================================================
echo [1/1] Building install package (client + NSIS installer) ...
echo ============================================================
cd /d "%~dp0client"
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
