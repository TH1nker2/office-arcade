# ============================================================
# 下载指定平台的 Node 运行时（带 SHA256 校验）
#
#   开发用（本机，落到 runtime\）：
#     powershell -ExecutionPolicy Bypass -File tools\fetch-runtime.ps1
#
#   打包用（落到 vendor\<target>\）：
#     powershell -ExecutionPolicy Bypass -File tools\fetch-runtime.ps1 -Target win-x64,linux-x64,darwin-arm64
#
#   可选：-Force 重新下载
# ============================================================
param(
    [string[]]$Target = @(),
    [string]$Dest = '',
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root

function Read-Utf8($path) { [IO.File]::ReadAllText($path, [Text.Encoding]::UTF8) }

$manifest = Read-Utf8 (Join-Path $root 'tools\runtime-manifest.json') | ConvertFrom-Json
$nodeVer = $manifest.node

# 当前机器的 target
function Get-HostTarget {
    $arch = if ([Environment]::Is64BitProcess) { 'x64' } else { 'x86' }
    if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { $arch = 'arm64' }
    if ($IsWindows -or $env:OS -eq 'Windows_NT') { return "win-$arch" }
    if ($IsMacOS) { return "darwin-$arch" }
    return "linux-$arch"
}

# 兼容 -Target a,b,c 和 -Target a b c 两种写法
$Target = @($Target | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ })

if ($Target.Count -eq 0) {
    $Target = @(Get-HostTarget)
    if (-not $Dest) { $Dest = 'runtime' }
}
if (-not $Dest) { $Dest = 'vendor' }

Write-Host ("Node v" + $nodeVer + " / 目标: " + ($Target -join ', ')) -ForegroundColor Cyan

$cache = Join-Path $root 'vendor\_cache'
New-Item -ItemType Directory -Force -Path $cache | Out-Null

foreach ($t in $Target) {
    $info = $manifest.targets.$t
    if (-not $info) {
        Write-Host ("  跳过 $t（manifest 里没有这个平台）") -ForegroundColor Yellow
        continue
    }

    $outDir = Join-Path $root (Join-Path $Dest $t)
    if ($Dest -eq 'runtime') { $outDir = Join-Path $root 'runtime' }
    $binPath = Join-Path $outDir $info.binary

    if ((Test-Path $binPath) -and -not $Force) {
        Write-Host ("  $t 已存在，跳过") -ForegroundColor DarkGray
        continue
    }

    $archive = Join-Path $cache $info.archive
    if (-not (Test-Path $archive)) {
        $url = $manifest.dist + "/v" + $nodeVer + "/" + $info.archive
        Write-Host ("  下载 " + $info.archive + " (" + $info.size + ") ...")
        $ProgressPreference = 'SilentlyContinue'
        Invoke-WebRequest -Uri $url -OutFile $archive -UseBasicParsing -TimeoutSec 900
    }

    Write-Host "  校验 SHA256 ..."
    $hash = (Get-FileHash $archive -Algorithm SHA256).Hash.ToLower()
    if ($hash -ne $info.sha256.ToLower()) {
        Remove-Item $archive -Force
        throw ("校验失败 " + $info.archive + "`n  期望 " + $info.sha256 + "`n  实际 " + $hash)
    }

    Write-Host "  解压 ..."
    $tmp = Join-Path $cache ("unpack-" + $t)
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Force -Path $tmp | Out-Null

    if ($info.archive -like '*.zip') {
        Expand-Archive -Path $archive -DestinationPath $tmp -Force
    } else {
        tar -xf $archive -C $tmp
        if ($LASTEXITCODE -ne 0) { throw "解压失败: $($info.archive)" }
    }

    New-Item -ItemType Directory -Force -Path $outDir | Out-Null
    $found = Get-ChildItem $tmp -Recurse -File -Filter $info.binary |
        Where-Object { $_.Directory.Name -notlike 'node_modules' } | Select-Object -First 1
    if (-not $found) { throw "压缩包里找不到 " + $info.binary }
    Copy-Item $found.FullName -Destination $binPath -Force
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue

    $mb = [math]::Round((Get-Item $binPath).Length / 1MB, 1)
    Write-Host ("  -> " + $binPath.Replace($root + '\', '') + " ($mb MB)") -ForegroundColor Green
}

Write-Host "完成。"
