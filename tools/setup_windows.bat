@echo off
setlocal enabledelayedexpansion
REM ============================================================
REM Gipfel server - first-time deploy script (Windows Server)
REM Mirrors tools/setup_debian.sh.
REM Steps: check tools -> generate .env + strong JWT_SECRET ->
REM   npm ci -> prisma generate+db push -> npm run build ->
REM   pm2 start -> pm2 save -> prompt pm2 startup.
REM Usage: cd repo && setup_windows.bat
REM Note: pure ASCII (GBK codepage would mangle UTF-8).
REM ============================================================
cd /d "%~dp0.."
set "REPO=%CD%"
cd /d "%REPO%\server"

REM --- check tools ---
where node >nul 2>&1 || (echo [ERR] node not found & exit /b 1)
where npm  >nul 2>&1 || (echo [ERR] npm not found & exit /b 1)
where git  >nul 2>&1 || (echo [ERR] git not found & exit /b 1)

REM node major >= 20
for /f %%i in ('node -e "console.log(process.versions.node.split('.')[0])"') do set "NM=%%i"
if %NM% LSS 20 (echo [ERR] Node.js %NM% too old, need >= 20 & exit /b 1)
echo [setup] node %NM% / npm ok

where pm2 >nul 2>&1
if errorlevel 1 (
  echo [WARN] pm2 not found, installing globally...
  call npm install -g pm2 || (echo [ERR] pm2 install failed & exit /b 1)
)

REM --- generate .env (strong random JWT_SECRET via node crypto) ---
if not exist ".env" (
  echo [setup] generating .env from .env.example ...
  node -e "const fs=require('fs');const c=fs.readFileSync('.env.example','utf8').replace(/^JWT_SECRET=.*$/m,'JWT_SECRET='+require('crypto').randomBytes(32).toString('hex'));fs.writeFileSync('.env',c);console.log('JWT_SECRET set');"
) else (
  echo [WARN] .env exists, keep existing config.
)

REM --- install deps (npmmirror) ---
echo [setup] npm ci ...
set "NPM_CONFIG_REGISTRY=https://registry.npmmirror.com"
call npm ci
if errorlevel 1 (echo [ERR] npm ci failed & exit /b 1)

REM --- database ---
echo [setup] prisma generate + db push ...
call npx prisma generate
if errorlevel 1 (echo [ERR] prisma generate failed & exit /b 1)
call npx prisma db push
if errorlevel 1 (echo [ERR] prisma db push failed & exit /b 1)

REM --- build ---
echo [setup] npm run build ...
call npm run build
if errorlevel 1 (echo [ERR] build failed & exit /b 1)

REM --- pm2 ---
echo [setup] pm2 start ...
call pm2 start ecosystem.config.js
if errorlevel 1 (echo [ERR] pm2 start failed & exit /b 1)
call pm2 save

echo [setup] health check /api/ping
curl.exe -fsS http://localhost:3000/api/ping >nul 2>&1 && echo [OK] service ready || echo [WARN] health check failed, see pm2 logs gipfel-server

echo ============================================================
echo  First deploy done. For auto-start on boot, run as admin:
echo    pm2 startup
echo    pm2 save
echo  Default admin: admin / admin123 (change on first login).
echo ============================================================
exit /b 0
