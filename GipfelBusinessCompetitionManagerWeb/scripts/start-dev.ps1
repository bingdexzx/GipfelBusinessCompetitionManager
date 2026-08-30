# ============================================================
# Gipfel · Windows 开发启动（Django 8000 + Vite 5173 并行）
#
# 依赖：先执行过 scripts\bootstrap-dev.ps1
#
# 执行：
#   cd GipfelBusinessCompetitionManagerWeb
#   powershell -ExecutionPolicy Bypass -File scripts\start-dev.ps1
#
# 特性：
#   - 启动两个后台进程（Django + Vite），它们的 stdout/stderr 持续写到 logs\ 并 tail 到当前控制台
#   - Ctrl+C 时自动 Stop-Process 两个子进程（try/finally 保证清理）
#   - 启动前做存活探活，日志里打印两个 URL
# ============================================================
[CmdletBinding()]
param(
    [string]$BackendDir   = (Join-Path $PSScriptRoot "..\backend"),
    [string]$FrontendDir  = (Join-Path $PSScriptRoot "..\frontend"),
    [string]$BackendBind  = "127.0.0.1:8000",
    [string]$VitePort     = "5173",
    [switch]$OpenBrowser
)

$ErrorActionPreference = "Stop"

function Write-Info  { Write-Host ("[INFO]  " + $args) -ForegroundColor Cyan }
function Write-OK    { Write-Host ("[OK]    " + $args) -ForegroundColor Green }
function Write-Warn  { Write-Host ("[WARN]  " + $args) -ForegroundColor Yellow }
function Write-Err   { Write-Host ("[ERROR] " + $args) -ForegroundColor Red }

$BackendDir  = [System.IO.Path]::GetFullPath($BackendDir)
$FrontendDir = [System.IO.Path]::GetFullPath($FrontendDir)
$LogDir      = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\logs"))
$null = New-Item -ItemType Directory -Force -Path $LogDir

$backendLog = Join-Path $LogDir "backend.log"
$viteLog    = Join-Path $LogDir "vite.log"

# 前置检查
$pyExe  = Join-Path $BackendDir ".venv\Scripts\python.exe"
if (-not (Test-Path $pyExe)) {
    Write-Err "找不到 $pyExe。请先运行：scripts\bootstrap-dev.ps1"
    exit 1
}
if (-not (Test-Path (Join-Path $FrontendDir "node_modules\.bin\vite.cmd"))) {
    Write-Err "前端依赖未安装，请先运行：scripts\bootstrap-dev.ps1"
    exit 1
}

$BackendHost, $BackendPort = $BackendBind.Split(":", 2)
$backendProc = $null
$viteProc    = $null

try {
    # --- 1) 启动 Django（daphne 通过 runserver 接管）---
    if (Test-Path $backendLog) { Clear-Content $backendLog -ErrorAction SilentlyContinue }
    Write-Info "启动 Django → $BackendBind"
    $backendProc = Start-Process python.exe `
        -ArgumentList @($pyExe, "manage.py", "runserver", $BackendBind, "--noreload") `
        -WorkingDirectory $BackendDir `
        -RedirectStandardOutput $backendLog `
        -RedirectStandardError $backendLog `
        -UseNewEnvironment:$false `
        -PassThru -NoNewWindow
    Start-Sleep -Milliseconds 500
    if ($backendProc.HasExited) {
        Write-Err "Django 立即退出，日志如下："
        Get-Content $backendLog
        exit 1
    }

    # 探活：最多 12s
    $probe = "http://${BackendHost}:${BackendPort}/api/health"
    Write-Info "探活 Django $probe ..."
    for ($i = 0; $i -lt 24; $i++) {
        try {
            $r = Invoke-RestMethod -Uri $probe -Method Get -TimeoutSec 2 -ErrorAction Stop
            if ($r.ok) { Write-OK "Django 就绪"; break }
        } catch {}
        Start-Sleep -Milliseconds 500
    }

    # --- 2) 启动 Vite ---
    if (Test-Path $viteLog) { Clear-Content $viteLog -ErrorAction SilentlyContinue }
    Write-Info "启动 Vite → 127.0.0.1:${VitePort}"
    $env:VITE_PORT = $VitePort
    $viteProc = Start-Process npm.cmd `
        -ArgumentList @("run", "dev", "--", "--host", "127.0.0.1", "--port", $VitePort) `
        -WorkingDirectory $FrontendDir `
        -RedirectStandardOutput $viteLog `
        -RedirectStandardError $viteLog `
        -PassThru -NoNewWindow
    Start-Sleep -Milliseconds 500
    if ($viteProc.HasExited) {
        Write-Err "Vite 立即退出，日志如下："
        Get-Content $viteLog
        exit 1
    }

    # Vite 探活：最多 15s（第一次启动可能冷编译）
    for ($i = 0; $i -lt 30; $i++) {
        try {
            $null = Invoke-WebRequest -Uri "http://127.0.0.1:${VitePort}/" -Method Head -TimeoutSec 2 -ErrorAction Stop
            Write-OK "Vite 就绪"
            break
        } catch {}
        Start-Sleep -Milliseconds 500
    }

    # --- 打开浏览器 ---
    if ($OpenBrowser) {
        Start-Process "http://127.0.0.1:${VitePort}/"
    }

    Write-Host ""
    Write-OK "服务已全部启动"
    Write-Host "  前端(Vite) : http://127.0.0.1:${VitePort}"
    Write-Host "  后端(Daphne): http://${BackendBind}"
    Write-Host "  Django 日志 : Get-Content $backendLog -Wait -Tail 30"
    Write-Host "  Vite   日志 : Get-Content $viteLog    -Wait -Tail 30"
    Write-Host ""
    Write-Warn "Ctrl + C 会停止两个子进程并退出"

    # --- 合并 tail：直到收到 Ctrl+C ---
    $bTail = Start-Job -ArgumentList $backendLog -ScriptBlock {
        param($Path)
        Get-Content -Path $Path -Wait -Tail 0 -ErrorAction SilentlyContinue | ForEach-Object { "[DJANGO]  $_" }
    }
    $vTail = Start-Job -ArgumentList $viteLog -ScriptBlock {
        param($Path)
        Get-Content -Path $Path -Wait -Tail 0 -ErrorAction SilentlyContinue | ForEach-Object { "[VITE]    $_" }
    }
    try {
        while ($true) {
            Receive-Job -Job $bTail
            Receive-Job -Job $vTail
            Start-Sleep -Milliseconds 500
            # 任何子进程挂了就提示
            if ($backendProc.HasExited) { Write-Warn "Django 已退出，退出码 $($backendProc.ExitCode)" }
            if ($viteProc.HasExited)    { Write-Warn "Vite 已退出，退出码 $($viteProc.ExitCode)" }
            if ($backendProc.HasExited -and $viteProc.HasExited) { break }
        }
    } finally {
        Remove-Job -Job $bTail -Force -ErrorAction SilentlyContinue
        Remove-Job -Job $vTail -Force -ErrorAction SilentlyContinue
    }
} finally {
    Write-Host ""
    Write-Warn "正在停止子进程..."
    foreach ($p in @($backendProc, $viteProc)) {
        if ($null -ne $p -and -not $p.HasExited) {
            try {
                Stop-Process -Id $p.Id -Force -ErrorAction Stop
                Write-Info "已停止 PID $($p.Id)"
            } catch {
                Write-Warn "停止 PID $($p.Id) 失败：$_"
            }
        }
    }
    Write-OK "已退出"
}
