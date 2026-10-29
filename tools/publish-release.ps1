# ============================================================
# 一键发版：构建三平台包 -> 建 Gitee 发行版 -> 上传附件
#
#   $env:GITEE_TOKEN = "你的私人令牌"     # 只需 projects 权限
#   powershell -ExecutionPolicy Bypass -File tools\publish-release.ps1
#
# 可选参数：
#   -SkipBuild             不重新构建，直接上传 dist 下已有的包
#   -DryRun                只打印计划，不调接口
#   -CheckOnly             只做配额/清理预检，不创建发行版、不上传、不删除
#   -PruneOldReleases      显式清理旧版本安装包附件（发行版页面永久保留）
#   -KeepVersions 3        保留最近几个版本的安装包（默认 3）
#   -QuotaLimitMB 900      Gitee 附件预检阈值（默认 900 MB）
#   -Force                 清理时跳过确认（危险，仅限明确知道自己在做什么）
#
# 默认行为：
#   * 绝不删除任何发行版页面
#   * 附件总量超过阈值时停止，不会静默清理
#   * 只有显式传 -PruneOldReleases 才删除旧附件
#   * 删除前会确认 GitHub Release 已有对应安装包，否则跳过该版本
#
# GitHub 安装包由 tag 推送触发的 .github/workflows/mirror-release-assets.yml 自动镜像。
# ============================================================
param(
    [string]$Token = $env:GITEE_TOKEN,
    [string]$Repo = 'th1nker/office-arcade',
    [string]$GitHubRepo = 'TH1nker2/office-arcade',
    [switch]$SkipBuild,
    [switch]$DryRun,
    [switch]$CheckOnly,
    [switch]$PruneOldReleases,
    [int]$KeepVersions = 3,
    [int]$QuotaLimitMB = 900,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Net.Http
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root

function Read-Utf8($path) { [IO.File]::ReadAllText($path, [Text.Encoding]::UTF8) }
function Write-Utf8($path, $text) {
    [IO.File]::WriteAllText($path, $text, (New-Object Text.UTF8Encoding($false)))
}
function Format-MB([double]$bytes) { return [math]::Round($bytes / 1MB, 1) }

if ($KeepVersions -lt 1) { throw "-KeepVersions 至少为 1" }
if ($QuotaLimitMB -lt 100) { throw "-QuotaLimitMB 至少为 100" }

$ver = (Read-Utf8 (Join-Path $root 'version.json') | ConvertFrom-Json).version
$tag = "v$ver"
$dist = Join-Path $root 'dist'

Write-Host ""
Write-Host "== 发版 $tag ==" -ForegroundColor Cyan

# ---------- 构建 ----------
if (-not $SkipBuild) {
    Write-Host "[1/4] 构建三平台发行包..."
    & (Join-Path $root 'tools\build-release.ps1')
} else {
    Write-Host "[1/4] 跳过构建"
}

$artifacts = @(Get-ChildItem $dist -File |
    Where-Object { $_.Name -match ('^office-arcade-v' + [regex]::Escape($ver) + '-.+\.(zip|tar\.gz)$') } |
    Sort-Object Name)
if (-not $artifacts.Count) { throw "dist 下没有 v$ver 的发行包" }

Write-Host "      待上传：" -NoNewline
Write-Host ($artifacts.Count.ToString() + " 个包") -ForegroundColor Green
$artifacts | ForEach-Object {
    Write-Host ("        " + $_.Name.PadRight(46) + (Format-MB $_.Length).ToString().PadLeft(6) + " MB")
}
$newBytes = ($artifacts | Measure-Object -Property Length -Sum).Sum

if ($DryRun) {
    Write-Host "[2/4] DryRun：将检查 Gitee 附件配额（不调接口，跳过实际检查）"
    Write-Host "[3/4] DryRun：将创建/复用发行版 $tag"
    Write-Host "[4/4] DryRun：将上传上面这些包，结束（未调用接口）"
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

function Get-GiteeReleases {
    $page = 1
    $all = @()
    do {
        $url = "$api/releases?access_token=$Token&page=$page&per_page=100"
        $chunk = Invoke-RestMethod -Uri $url -Method Get
        $items = @($chunk | ForEach-Object { $_ })
        $all += $items
        $page++
    } while ($items.Count -eq 100)
    return $all
}

function Get-ReleaseAttachments($releaseId) {
    $url = "$api/releases/$releaseId/attach_files?access_token=$Token"
    try {
        $files = Invoke-RestMethod -Uri $url -Method Get
        return @($files | ForEach-Object { $_ })
    } catch {
        $code = 0
        try { $code = [int]$_.Exception.Response.StatusCode.value__ } catch { /* ignore */ }
        if ($code -eq 404) { return @() }
        throw
    }
}

function Test-InstallerName($name) {
    return ($name -match '^office-arcade-v.+\.(zip|tar\.gz)$')
}

function Get-ExistingAttachmentBytes($attachmentMap, $installerMap) {
    $bytes = 0
    foreach ($id in $attachmentMap.Keys) {
        foreach ($f in @($attachmentMap[$id])) {
            if ($f.size) { $bytes += [long]$f.size }
        }
    }
    return $bytes
}

# ---------- Gitee 附件配额预检 + 显式清理 ----------
Write-Host "[2/4] 检查 Gitee 附件配额（阈值 $QuotaLimitMB MB）..."
$releases = @(Get-GiteeReleases)
$attachmentMap = @{}
$installerMap = @{}
foreach ($rel in $releases) {
    $files = @(Get-ReleaseAttachments $rel.id)
    $attachmentMap[[string]$rel.id] = $files
    $installers = @($files | Where-Object { Test-InstallerName $_.name })
    if ($installers.Count -gt 0) { $installerMap[[string]$rel.id] = $installers }
}

$existingBytes = Get-ExistingAttachmentBytes $attachmentMap $installerMap
$projectedMB = Format-MB ($existingBytes + $newBytes)
Write-Host ("      现有附件 " + (Format-MB $existingBytes) + " MB + 本次安装包 " + (Format-MB $newBytes) + " MB = " + $projectedMB + " MB")

if ($CheckOnly -and -not $PruneOldReleases) {
    Write-Host "CheckOnly：配额预检结束，未修改任何内容" -ForegroundColor Cyan
    return
}

if ($projectedMB -gt $QuotaLimitMB -and -not $PruneOldReleases) {
    throw ("Gitee 附件预计 " + $projectedMB + " MB，超过阈值 " + $QuotaLimitMB + " MB。脚本不会自动删除任何内容。`n" +
        "  请检查旧版本附件后，显式加 -PruneOldReleases 再运行；发行版页面会永久保留。")
}

if ($PruneOldReleases) {
    Write-Host "[2/4] 显式清理旧版本安装包附件（页面保留，KeepVersions=$KeepVersions）..."
    $withAssets = @($releases |
        Where-Object { $installerMap.ContainsKey([string]$_.id) -and $_.tag_name -ne $tag } |
        Sort-Object { [string]$_.created_at } -Descending)
    $keepOld = [math]::Max(0, $KeepVersions - 1)
    $candidates = @($withAssets | Select-Object -Skip $keepOld)

    if (-not $candidates.Count) {
        Write-Host "      没有需要清理的旧版本附件" -ForegroundColor DarkGray
    } else {
        $ghToken = $env:GITHUB_TOKEN
        if (-not $ghToken) {
            Write-Host "      跳过清理：缺少 GITHUB_TOKEN，无法确认 GitHub 已有归档" -ForegroundColor Yellow
            $candidates = @()
        } else {
            $ghHeaders = @{
                Authorization = "Bearer $ghToken"
                Accept        = 'application/vnd.github+json'
                'User-Agent'  = 'office-arcade-release'
                'X-GitHub-Api-Version' = '2022-11-28'
            }
            $allowed = @()
            foreach ($c in $candidates) {
                $expected = @($installerMap[[string]$c.id]).Count
                try {
                    $gh = Invoke-RestMethod -Uri "https://api.github.com/repos/$GitHubRepo/releases/tags/$($c.tag_name)" -Headers $ghHeaders -Method Get
                    $ghCount = @($gh.assets | Where-Object { Test-InstallerName $_.name }).Count
                    if ($ghCount -ge $expected) {
                        $allowed += $c
                    } else {
                        Write-Host ("      跳过 " + $c.tag_name + "：GitHub 只有 " + $ghCount + " 个安装包，Gitee 有 " + $expected + " 个") -ForegroundColor Yellow
                    }
                } catch {
                    Write-Host ("      跳过 " + $c.tag_name + "：GitHub 归档查询失败（" + $_.Exception.Message + "）") -ForegroundColor Yellow
                }
            }

            if ($allowed.Count -gt 0) {
                Write-Host "      将删除以下版本的 Gitee 安装包附件（页面保留；仅删附件）："
                foreach ($c in $allowed) {
                    $files = @($installerMap[[string]$c.id])
                    $mb = Format-MB (($files | Measure-Object -Property size -Sum).Sum)
                    Write-Host ("        " + $c.tag_name + "： " + $files.Count + " 个附件，" + $mb + " MB")
                }
                if ($CheckOnly) {
                    Write-Host "CheckOnly：预检结束，未删除任何附件" -ForegroundColor Cyan
                    return
                }
                $confirmed = $Force
                if (-not $confirmed) {
                    $answer = Read-Host "      输入 YES 确认删除；其他输入将跳过清理"
                    $confirmed = ($answer -eq 'YES')
                }
                if (-not $confirmed) {
                    Write-Host "      已取消清理" -ForegroundColor Yellow
                } else {
                    $deletedBytes = 0
                    foreach ($c in $allowed) {
                        foreach ($f in @($installerMap[[string]$c.id])) {
                            $url = "$api/releases/$($c.id)/attach_files/$($f.id)?access_token=$Token"
                            Invoke-RestMethod -Uri $url -Method Delete | Out-Null
                            if ($f.size) { $deletedBytes += [long]$f.size }
                            Write-Host ("        删除 " + $c.tag_name + " / " + $f.name) -ForegroundColor DarkGray
                        }
                    }
                    $existingBytes -= $deletedBytes
                    Write-Host ("      已删除 " + (Format-MB $deletedBytes) + " MB，剩余约 " + (Format-MB $existingBytes) + " MB")
                    $projectedMB = Format-MB ($existingBytes + $newBytes)
                }
            }
        }
    }
    if (-not $CheckOnly -and $projectedMB -gt $QuotaLimitMB) {
        throw ("清理后预计仍为 " + $projectedMB + " MB，超过阈值 " + $QuotaLimitMB + " MB。请手动检查 Gitee 附件。")
    }
    if ($CheckOnly) {
        Write-Host "CheckOnly：预检结束，未删除任何附件" -ForegroundColor Cyan
        return
    }
}

# ---------- 建发行版 ----------
Write-Host "[3/4] 创建发行版 $tag ..."
$notesFile = Join-Path $dist 'release-notes.md'
if (-not (Test-Path $notesFile)) {
    $verInfo = Read-Utf8 (Join-Path $root 'version.json') | ConvertFrom-Json
    $lines = @("## 摸鱼游戏厅 v$($verInfo.version)", '')
    if ($verInfo.released) { $lines += "发布日期：$($verInfo.released)"; $lines += '' }
    foreach ($n in @($verInfo.notes)) { $lines += "- $n" }
    Write-Utf8 $notesFile (($lines -join "`n") + "`n")
    Write-Host "       已自动生成 dist\release-notes.md" -ForegroundColor DarkGray
}
$notes = Read-Utf8 $notesFile
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
Write-Host "[4/4] 上传附件 ..."
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

Write-Host "发行版页面： https://gitee.com/$Repo/releases/tag/$tag" -ForegroundColor Green
Write-Host "GitHub 镜像：先 git fetch --tags，再 git push github main / --tags；tag 推送会自动触发 mirror-release-assets 工作流。" -ForegroundColor Cyan
