# ============================================================
# 一键发版：构建三平台包 -> 建 Gitee 发行版 -> 上传全部附件
#
#   $env:GITEE_TOKEN = "你的私人令牌"     # 只需 projects 权限
#   powershell -ExecutionPolicy Bypass -File tools\publish-release.ps1
#
# 可选参数：
#   -SkipBuild   不重新构建，直接上传 dist 下已有的包
#   -DryRun      只打印计划，不调接口
# ============================================================
param(
    [string]$Token = $env:GITEE_TOKEN,
    [string]$Repo = 'th1nker/office-arcade',
    [switch]$SkipBuild,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Net.Http
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root

function Read-Utf8($path) { [IO.File]::ReadAllText($path, [Text.Encoding]::UTF8) }

$ver = (Read-Utf8 (Join-Path $root 'version.json') | ConvertFrom-Json).version
$tag = "v$ver"
$dist = Join-Path $root 'dist'

Write-Host ""
Write-Host "== 发版 $tag ==" -ForegroundColor Cyan

# ---------- 构建 ----------
if (-not $SkipBuild) {
    Write-Host "[1/3] 构建三平台发行包..."
    & (Join-Path $root 'tools\build-release.ps1')
} else {
    Write-Host "[1/3] 跳过构建"
}

$artifacts = @(Get-ChildItem $dist -File |
    Where-Object { $_.Name -match ('^office-arcade-v' + [regex]::Escape($ver) + '-.+\.(zip|tar\.gz)$') } |
    Sort-Object Name)
if (-not $artifacts.Count) { throw "dist 下没有 v$ver 的发行包" }

Write-Host "      待上传：" -NoNewline
Write-Host ($artifacts.Count.ToString() + " 个包") -ForegroundColor Green
$artifacts | ForEach-Object {
    Write-Host ("        " + $_.Name.PadRight(46) + ([math]::Round($_.Length / 1MB, 1)).ToString().PadLeft(6) + " MB")
}

if ($DryRun) {
    Write-Host "[2/3] DryRun：将创建/复用发行版 $tag"
    Write-Host "[3/3] DryRun：将上传上面这些包，结束（未调用接口）"
    return
}
if (-not $Token) { throw "缺少令牌：先设置 `$env:GITEE_TOKEN = '你的私人令牌'" }

# ---------- 发布前检查：远程 main 必须已经包含当前提交 ----------
# 否则 Gitee 会在「旧的 main」上打 tag，发行版指向的源码就和版本号对不上了
try {
    $dirty = git status --porcelain
    if ($dirty) {
        Write-Host "      提示：工作区有未提交改动，发行版里的源码会是最后一次提交的样子" -ForegroundColor Yellow
    }
    git fetch -q origin 2>$null
    $localHead = (git rev-parse HEAD).Trim()
    $remoteHead = (git rev-parse origin/main 2>$null).Trim()
    if ($remoteHead -and $localHead -ne $remoteHead) {
        throw "本地 main 和 origin/main 不一致，先 git push 再发版（否则 tag 会指到旧提交）"
    }
} catch [System.Management.Automation.RuntimeException] {
    if ($_.Exception.Message -like '*先 git push*') { throw }
    Write-Host "      提示：无法检查远程分支同步状态，已跳过" -ForegroundColor Yellow
}

$client = New-Object System.Net.Http.HttpClient
$client.Timeout = [TimeSpan]::FromMinutes(30)
$api = "https://gitee.com/api/v5/repos/$Repo"

function Read-Json($resp) {
    [Text.Encoding]::UTF8.GetString($resp.Content.ReadAsByteArrayAsync().Result) | ConvertFrom-Json
}

# ---------- 建发行版 ----------
Write-Host "[2/3] 创建发行版 $tag ..."
$notes = Read-Utf8 (Join-Path $dist 'release-notes.md')
$pairs = [ordered]@{
    tag_name         = $tag
    name             = "摸鱼游戏厅 $tag"
    body             = $notes
    target_commitish = 'main'
}
$encoded = ($pairs.Keys | ForEach-Object {
    [uri]::EscapeDataString($_) + '=' + [uri]::EscapeDataString($pairs[$_])
}) -join '&'
$content = New-Object System.Net.Http.StringContent(
    $encoded, [Text.Encoding]::UTF8, 'application/x-www-form-urlencoded')

$resp = $client.PostAsync("$api/releases?access_token=$Token", $content).Result
$code = [int]$resp.StatusCode
if ($code -eq 201 -or $code -eq 200) {
    $rel = Read-Json $resp
    Write-Host "       创建成功（id $($rel.id)）"
} else {
    $err = [Text.Encoding]::UTF8.GetString($resp.Content.ReadAsByteArrayAsync().Result)
    Write-Host "       创建返回 $code，尝试复用已存在的发行版" -ForegroundColor Yellow
    $get = $client.GetAsync("$api/releases/tags/$tag`?access_token=$Token").Result
    if ([int]$get.StatusCode -ne 200) { throw "发行版创建失败：$err" }
    $rel = Read-Json $get
    Write-Host "       复用 id $($rel.id)"
}

# ---------- 上传全部附件 ----------
Write-Host "[3/3] 上传附件 ..."
$fresh = Read-Json ($client.GetAsync("$api/releases/$($rel.id)?access_token=$Token").Result)
$existing = @{}
$fresh.assets | ForEach-Object { $existing[$_.name] = $_.browser_download_url }

$upCode = 0
foreach ($a in $artifacts) {
    if ($existing.ContainsKey($a.Name)) {
        Write-Host ("       " + $a.Name + " 已存在，跳过") -ForegroundColor DarkGray
        continue
    }
    Write-Host ("       " + $a.Name + " ...") -NoNewline
    $form = New-Object System.Net.Http.MultipartFormDataContent
    $fs = [IO.File]::OpenRead($a.FullName)
    try {
        $sc = New-Object System.Net.Http.StreamContent($fs)
        $sc.Headers.ContentType = [System.Net.Http.Headers.MediaTypeHeaderValue]::Parse('application/octet-stream')
        $form.Add($sc, 'file', $a.Name)
        $up = $client.PostAsync("$api/releases/$($rel.id)/attach_files?access_token=$Token", $form).Result
        $upCode = [int]$up.StatusCode
        if ($upCode -eq 200 -or $upCode -eq 201) {
            Write-Host " 完成" -ForegroundColor Green
        } else {
            $e2 = [Text.Encoding]::UTF8.GetString($up.Content.ReadAsByteArrayAsync().Result)
            Write-Host (" 失败（" + $upCode + "）：" + $e2) -ForegroundColor Red
        }
    } finally {
        $fs.Close()
    }
}

Write-Host ""
Write-Host "发行版页面： https://gitee.com/$Repo/releases/tag/$tag" -ForegroundColor Green
