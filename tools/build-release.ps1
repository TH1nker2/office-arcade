# ============================================================
# 构建多平台发行包（源码 + 对应平台 Node 运行时 + 启动器）
#
#   powershell -ExecutionPolicy Bypass -File tools\build-release.ps1
#   powershell -ExecutionPolicy Bypass -File tools\build-release.ps1 -Target win-x64
#   powershell -ExecutionPolicy Bypass -File tools\build-release.ps1 -WithShots   （把截图也打进去）
#
# 产物：dist\office-arcade-v<版本>-<target>.zip / .tar.gz
#       dist\SHA256SUMS.txt
#
# 前置：先跑 tools\fetch-runtime.ps1 把 runtime/ 和 vendor/ 准备好
# ============================================================
param(
    [string[]]$Target = @('win-x64', 'linux-x64', 'darwin-arm64'),
    [switch]$WithShots
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root

function Read-Utf8($path) { [IO.File]::ReadAllText($path, [Text.Encoding]::UTF8) }
function Write-Utf8($path, $text) {
    [IO.File]::WriteAllText($path, $text, (New-Object Text.UTF8Encoding($false)))
}

$Target = @($Target | ForEach-Object { $_ -split ',' } | Where-Object { $_.Trim() } | ForEach-Object { $_.Trim() })

$ver = (Read-Utf8 (Join-Path $root 'version.json') | ConvertFrom-Json).version
$manifest = Read-Utf8 (Join-Path $root 'tools\runtime-manifest.json') | ConvertFrom-Json
$dist = Join-Path $root 'dist'
$stageRoot = Join-Path $dist '_stage'

Write-Host ""
Write-Host ("== 构建 v" + $ver + " / " + ($Target -join ', ') + " ==") -ForegroundColor Cyan

# ---------- 找一个 python（打 tar.gz 用，保证可执行位） ----------
$python = $null
foreach ($c in @($env:PYTHON, 'python', 'python3', 'py')) {
    if (-not $c) { continue }
    $cmd = Get-Command $c -ErrorAction SilentlyContinue
    if (-not $cmd) { continue }
    # 有些机器上的 python 只是应用商店的占位程序，必须真跑一下才算数
    $probe = & $cmd.Source -c "print('PYOK')" 2>$null
    if ($probe -match 'PYOK') { $python = $cmd.Source; break }
}
if (-not $python) { Write-Host "  提示：没找到 python，tar.gz 会用 tar.exe 打包，解压后需要手动 chmod +x" -ForegroundColor Yellow }

New-Item -ItemType Directory -Force -Path $dist | Out-Null
Remove-Item $stageRoot -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $stageRoot | Out-Null

# ---------- 源码清单（排除运行时、构建产物、本机配置） ----------
$exclude = @('.git', 'data', 'dist', 'vendor', 'runtime', 'node_modules', 'admins.json', '.gitcheck', '.clone-check', '.zipcheck')
if (-not $WithShots) { $exclude += 'shots' }

$sums = @()

foreach ($t in $Target) {
    $info = $manifest.targets.$t
    if (-not $info) { Write-Host ("  跳过 $t（manifest 未定义）") -ForegroundColor Yellow; continue }

    $bin = Join-Path $root ("vendor\" + $t + "\" + $info.binary)
    if (-not (Test-Path $bin)) {
        Write-Host ("  缺少 vendor\" + $t + "\" + $info.binary + "，先跑 tools\fetch-runtime.ps1") -ForegroundColor Red
        continue
    }

    $isWin = $t -like 'win-*'
    $name = "office-arcade-v$ver-$t"
    $stage = Join-Path $stageRoot $name
    New-Item -ItemType Directory -Force -Path $stage | Out-Null

    # 源码
    Get-ChildItem -Force | Where-Object { $exclude -notcontains $_.Name } | ForEach-Object {
        Copy-Item $_.FullName -Destination $stage -Recurse -Force
    }
    # 启动器：只留该平台需要的
    if ($isWin) {
        Remove-Item (Join-Path $stage 'start.sh') -Force -ErrorAction SilentlyContinue
        Remove-Item (Join-Path $stage 'start.command') -Force -ErrorAction SilentlyContinue
        Remove-Item (Join-Path $stage '获取运行环境.bat') -Force -ErrorAction SilentlyContinue
    } else {
        Remove-Item (Join-Path $stage '启动游戏厅.bat') -Force -ErrorAction SilentlyContinue
        Remove-Item (Join-Path $stage '获取运行环境.bat') -Force -ErrorAction SilentlyContinue
    }

    # 运行时
    $rt = Join-Path $stage 'runtime'
    New-Item -ItemType Directory -Force -Path $rt | Out-Null
    Copy-Item $bin -Destination (Join-Path $rt $info.binary) -Force

    # 随机管理员密码
    $bytes = New-Object byte[] 6
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $pw = ($bytes | ForEach-Object { $_.ToString('x2') }) -join ''
    $admin = [ordered]@{
        _readme = '管理员账号。密码可以随时改，改完重启服务器生效。'
        admins  = @([ordered]@{ username = 'admin'; password = $pw; name = '超级管理员' })
    }
    Write-Utf8 (Join-Path $stage 'admins.json') ($admin | ConvertTo-Json -Depth 6)

    # 首次使用说明
    $howto = if ($isWin) {
@"
双击「启动游戏厅.bat」，浏览器会自动打开 http://localhost:8090
把终端里打印的「局域网访问」地址发给同事，他们用浏览器打开就能玩
"@
    } else {
@"
终端里执行： ./start.sh          （macOS 也可以双击 start.command）
然后浏览器打开： http://localhost:8090
把局域网地址发给同事，他们用浏览器打开就能玩
"@
    }
    $readme = @"
摸鱼游戏厅 v$ver · $t
================================================

$howto

管理后台： http://localhost:8090/admin.html
   账号  admin
   密码  $pw
   （密码在 admins.json 里改，改完重启生效）

数据都放在 data/ 目录（首次启动自动生成）：
   备份 = 复制整个 data 目录
   换机器 = 把 data 目录拷到同位置

端口被占用就换一个： 端口号跟在启动命令后面，例如 ./start.sh 8091
"@
    Write-Utf8 (Join-Path $stage '首次使用.txt') $readme

    # ---------- 打包 ----------
    Write-Host ("  [" + $t + "] 打包 " + $name + " ...") -NoNewline
    if ($isWin) {
        $out = Join-Path $dist ($name + '.zip')
        if (Test-Path $out) { Remove-Item $out -Force }
        Compress-Archive -Path $stage -DestinationPath $out -CompressionLevel Fastest
    } else {
        $out = Join-Path $dist ($name + '.tar.gz')
        if (Test-Path $out) { Remove-Item $out -Force }
        if ($python) {
            & $python (Join-Path $root 'tools\pack-tar.py') $out $stage | Out-Null
            if ($LASTEXITCODE -ne 0) { throw "pack-tar.py 失败" }
        } else {
            Push-Location $stageRoot
            tar -czf $out $name
            Pop-Location
            if ($LASTEXITCODE -ne 0) { throw "tar 打包失败" }
        }
    }

    $mb = [math]::Round((Get-Item $out).Length / 1MB, 1)
    Write-Host (" " + $mb + " MB") -ForegroundColor Green
    $hash = (Get-FileHash $out -Algorithm SHA256).Hash.ToLower()
    $sums += ($hash + "  " + (Split-Path $out -Leaf))
    Remove-Item $stage -Recurse -Force
}

Remove-Item $stageRoot -Recurse -Force -ErrorAction SilentlyContinue

if ($sums.Count) {
    $sumFile = Join-Path $dist 'SHA256SUMS.txt'
    Write-Utf8 $sumFile ($sums -join "`n") + "`n"
    Write-Host ""
    Write-Host "产物：" -ForegroundColor Cyan
    Get-ChildItem $dist -File | Where-Object { $_.Name -match '\.(zip|tar\.gz)$' } |
        Sort-Object Name | ForEach-Object {
            Write-Host ("  " + $_.Name.PadRight(46) + ([math]::Round($_.Length / 1MB, 1)).ToString().PadLeft(6) + " MB")
        }
    Write-Host ""
    Write-Host ("校验：dist\SHA256SUMS.txt")
} else {
    Write-Host "没有产出任何包，检查 -Target 和 vendor 目录" -ForegroundColor Red
}
