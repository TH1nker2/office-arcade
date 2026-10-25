# ============================================================
# 构建多平台发行包（标准版 + 便携版）
#
#   powershell -ExecutionPolicy Bypass -File tools\build-release.ps1
#   powershell -ExecutionPolicy Bypass -File tools\build-release.ps1 -Edition standard
#   powershell -ExecutionPolicy Bypass -File tools\build-release.ps1 -Target win-x64 -WithShots
#
# 两个版本的区别只有一个：数据放哪
#   standard  标准版   数据放用户目录（Windows: %APPDATA%\office-arcade）
#   portable  便携版   数据放软件目录下的 data\
#
# 产物：dist\office-arcade-v<版本>-<平台>-<版本类型>.zip|.tar.gz
#       dist\SHA256SUMS.txt
#
# 前置：先跑 tools\fetch-runtime.ps1 把 vendor/ 里三个平台的运行时准备好
# ============================================================
param(
    [string[]]$Target = @('win-x64', 'linux-x64', 'darwin-arm64'),
    [string[]]$Edition = @('standard', 'portable'),
    [switch]$WithShots
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root

function Read-Utf8($path) { [IO.File]::ReadAllText($path, [Text.Encoding]::UTF8) }
function Write-Utf8($path, $text) {
    [IO.File]::WriteAllText($path, $text, (New-Object Text.UTF8Encoding($false)))
}

$Target = @($Target | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
$Edition = @($Edition | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ })

$ver = (Read-Utf8 (Join-Path $root 'version.json') | ConvertFrom-Json).version
$manifest = Read-Utf8 (Join-Path $root 'tools\runtime-manifest.json') | ConvertFrom-Json
$dist = Join-Path $root 'dist'
$stageRoot = Join-Path $dist '_stage'

Write-Host ""
Write-Host ("== 构建 v" + $ver + " / " + ($Target -join ', ') + " / " + ($Edition -join ', ') + " ==") -ForegroundColor Cyan

# ---------- 找一个能用的 python（打 tar.gz 时保留可执行位） ----------
$python = $null
foreach ($c in @($env:PYTHON, 'python', 'python3', 'py')) {
    if (-not $c) { continue }
    $cmd = Get-Command $c -ErrorAction SilentlyContinue
    if (-not $cmd) { continue }
    $probe = & $cmd.Source -c "print('PYOK')" 2>$null
    if ($probe -match 'PYOK') { $python = $cmd.Source; break }
}
if (-not $python) { Write-Host "  提示：没找到 python，tar.gz 用 tar.exe 打包，解压后需要 chmod +x" -ForegroundColor Yellow }

New-Item -ItemType Directory -Force -Path $dist | Out-Null
Remove-Item $stageRoot -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $stageRoot | Out-Null

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

    foreach ($ed in $Edition) {
        if ($ed -ne 'standard' -and $ed -ne 'portable') { continue }
        $isPortable = $ed -eq 'portable'

        $name = "office-arcade-v$ver-$t-$ed"
        $stage = Join-Path $stageRoot $name
        New-Item -ItemType Directory -Force -Path $stage | Out-Null

        # ---- 源码 ----
        Get-ChildItem -Force | Where-Object { $exclude -notcontains $_.Name } | ForEach-Object {
            Copy-Item $_.FullName -Destination $stage -Recurse -Force
        }

        # ---- 启动器：每个包只留自己那一套 ----
        $keep = if ($isWin) {
            if ($isPortable) { @('启动游戏厅-便携版.bat') } else { @('启动游戏厅.bat') }
        } else {
            if ($isPortable) { @('start-portable.sh', 'start-portable.command') } else { @('start.sh', 'start.command') }
        }
        Get-ChildItem $stage -File | Where-Object {
            $_.Extension -in @('.bat', '.sh', '.command')
        } | ForEach-Object {
            if ($keep -notcontains $_.Name) { Remove-Item $_.FullName -Force }
        }

        # ---- 运行时 ----
        $rt = Join-Path $stage 'runtime'
        New-Item -ItemType Directory -Force -Path $rt | Out-Null
        Copy-Item $bin -Destination (Join-Path $rt $info.binary) -Force

        # ---- 随机管理员密码 ----
        $bytes = New-Object byte[] 6
        [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
        $pw = ($bytes | ForEach-Object { $_.ToString('x2') }) -join ''
        $admin = [ordered]@{
            _readme = '管理员账号。密码可以随时改，改完重启服务器生效。'
            admins  = @([ordered]@{ username = 'admin'; password = $pw; name = '超级管理员' })
        }
        Write-Utf8 (Join-Path $stage 'admins.json') ($admin | ConvertTo-Json -Depth 6)

        # ---- 首次使用说明 ----
        $launch = if ($isWin) {
            if ($isPortable) { '双击「启动游戏厅-便携版.bat」' } else { '双击「启动游戏厅.bat」' }
        } else {
            if ($isPortable) { './start-portable.sh（macOS 也可以双击 start-portable.command）' } else { './start.sh（macOS 也可以双击 start.command）' }
        }
        $dataWhere = if ($isWin) {
            if ($isPortable) { '本文件夹下的 data\ 目录' } else { '%APPDATA%\office-arcade（即 C:\Users\<你>\AppData\Roaming\office-arcade）' }
        } else {
            if ($isPortable) { '本文件夹下的 data/ 目录' } else { 'macOS: ~/Library/Application Support/office-arcade；Linux: ~/.local/share/office-arcade' }
        }
        $editionName = if ($isPortable) { '便携版' } else { '标准版' }

        $readme = @"
摸鱼游戏厅 v$ver · $t · $editionName
================================================

启动： $launch
浏览器： http://localhost:8090
把局域网地址发给同事，他们用浏览器打开就能玩（不用装任何东西）

数据位置： $dataWhere
   备份 = 复制整个数据目录
   换机器 = 把数据目录拷到新机器的同位置

管理后台： http://localhost:8090/admin.html
   账号  admin
   密码  $pw
   （密码在 admins.json 里改，改完重启生效）

端口被占用就换一个：端口号跟在启动命令后面，例如 8091
"@
        Write-Utf8 (Join-Path $stage '首次使用.txt') $readme

        # ---- 打包 ----
        Write-Host ("  [" + $t + "/" + $ed + "] 打包 " + $name + " ...") -NoNewline
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
        $sums += ((Get-FileHash $out -Algorithm SHA256).Hash.ToLower() + "  " + (Split-Path $out -Leaf))
        Remove-Item $stage -Recurse -Force
    }
}

Remove-Item $stageRoot -Recurse -Force -ErrorAction SilentlyContinue

if ($sums.Count) {
    Write-Utf8 (Join-Path $dist 'SHA256SUMS.txt') (($sums -join "`n") + "`n")
    Write-Host ""
    Write-Host "产物：" -ForegroundColor Cyan
    Get-ChildItem $dist -File | Where-Object { $_.Name -match '\.(zip|tar\.gz)$' } |
        Sort-Object Name | ForEach-Object {
            Write-Host ("  " + $_.Name.PadRight(52) + ([math]::Round($_.Length / 1MB, 1)).ToString().PadLeft(6) + " MB")
        }
    Write-Host ""
    Write-Host ("校验：dist\SHA256SUMS.txt")
} else {
    Write-Host "没有产出任何包，检查 -Target/-Edition 和 vendor 目录" -ForegroundColor Red
}
