@echo off
setlocal
cd /d "%~dp0"

REM 国内镜像：加速 Electron / electron-builder 二进制下载，避免直连 GitHub 超时。
REM 如需默认源，删除下面两行即可。npm 包本身走你本机默认 registry；
REM 若想整体走 npmmirror，可在本文件开头加一行：set "NPM_CONFIG_REGISTRY=https://registry.npmmirror.com"
set "ELECTRON_MIRROR=https://cdn.npmmirror.com/binaries/electron/"
set "ELECTRON_BUILDER_BINARIES_MIRROR=https://cdn.npmmirror.com/binaries/electron-builder-binaries/"

echo ============================================================
echo [1/3] Installing server dependencies ...
echo ============================================================
cd /d "%~dp0server"
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
    echo [WARN] prisma generate 失败。若报错为 query_engine 重命名 EPERM，
    echo       请手动删除 node_modules/.prisma/client/*.tmp* 后重试：npm run prisma:generate
    echo       （这是沙箱/杀软拦截 rename 的偶发问题，普通机器上通常直接成功。）
)

echo.
echo ============================================================
echo [3/3] Installing client dependencies ...
echo ============================================================
cd /d "%~dp0client"
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
echo [OK] 依赖安装完成。
echo      若是全新库（数据库尚未初始化），继续：
echo        cd server ^&^& npx prisma db push ^&^& npx prisma db seed
echo      然后分别运行 start_server.bat 与 start_client.bat 启动。
echo ============================================================
echo Press any key to close this window.
pause >nul
exit /b 0
