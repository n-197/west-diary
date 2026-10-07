# 「歌詞を見る」で開く歌詞ページを、J-Lyric.net の WEST.／ジャニーズWEST の歌詞リストから曲名で探し、
# catalog.json と claude-page/catalog.json の lyrics（元の曲名 → ページのパス）に書き込む。
# 見つからない曲は、アプリ側で歌ネットの曲名検索を開く。
# build-catalog.ps1 を実行したあとに続けて実行する。
#   powershell -ExecutionPolicy Bypass -File tools\build-lyrics.ps1

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
# 改名後（WEST.）を先に読み、同じ曲名なら新しいほうを使う
$ArtistIds = @('a065c24', 'a058b38')

# J-Lyric.net 側の表記が違う曲（カタログの元の曲名 → J-Lyric.net の曲名）
$Aliases = @{
  'パーリパーリパリ'              = 'パーリパーリパリ - カタカナを叫べ -'
  '僕らの軌跡 ～WEST.列島縦断～' = '僕らの軌跡 ～ジャニーズWEST 列島縦断～'
}

# アプリの baseTitle と同じ：「〇〇 - From THE FIRST TAKE」「〇〇 (LIVE From …)」などは元の曲名にする
function Base-Title([string]$t) {
  $b = ($t -replace '\s+-\s+.*$', '' -replace '\s*[(（][^()（）]*[)）]$', '').Trim()
  if ($b) { return $b } else { return $t }
}

# 全角半角・大小文字・記号・アクセント（Olé → Ole）の違いを無視して比べる
function Normalize-Title([string]$t) {
  $s = $t.Normalize([Text.NormalizationForm]::FormKD).ToLowerInvariant()
  return ($s -replace '[\s\p{P}\p{S}\p{M}]', '')
}

function Read-Json([string]$path) {
  return [IO.File]::ReadAllText($path, [Text.Encoding]::UTF8) | ConvertFrom-Json
}

function Write-Json([string]$path, $data) {
  [IO.File]::WriteAllText($path, ($data | ConvertTo-Json -Depth 6 -Compress), (New-Object Text.UTF8Encoding $false))
}

$pages = @{}
$client = New-Object Net.WebClient
$client.Headers['User-Agent'] = 'Mozilla/5.0'
foreach ($id in $ArtistIds) {
  $html = [Text.Encoding]::UTF8.GetString($client.DownloadData("https://j-lyric.net/artist/$id/"))
  $links = [regex]::Matches($html, "href=""/artist/($id/l[0-9a-f]+)\.html"" title=""[^""]*"">([^<]+)</a>")
  foreach ($m in $links) {
    $key = Normalize-Title ([Net.WebUtility]::HtmlDecode($m.Groups[2].Value))
    if (-not $pages.ContainsKey($key)) { $pages[$key] = $m.Groups[1].Value }
  }
  Start-Sleep -Milliseconds 500
}
Write-Host "J-Lyric.net の曲: $($pages.Count) 曲"

$pwaPath = Join-Path $Root 'catalog.json'
$pwa = Read-Json $pwaPath
$titles = @($pwa.works | ForEach-Object { $_.songs | ForEach-Object { Base-Title $_.title } } | Select-Object -Unique | Sort-Object)

$lyrics = [ordered]@{}
$missing = @()
foreach ($t in $titles) {
  $name = $(if ($Aliases.ContainsKey($t)) { $Aliases[$t] } else { $t })
  $key = Normalize-Title $name
  if ($pages.ContainsKey($key)) { $lyrics[$t] = $pages[$key] } else { $missing += $t }
}
Write-Host "見つかった曲: $($lyrics.Count) / $($titles.Count)"
if ($missing) { Write-Host "見つからなかった曲（歌ネットの検索を開く）: $($missing -join ' / ')" }

foreach ($path in @($pwaPath, (Join-Path $Root 'claude-page\catalog.json'))) {
  $data = Read-Json $path
  Write-Json $path ([ordered]@{ updatedAt = $data.updatedAt; lyrics = $lyrics; works = $data.works })
}
Write-Host '完了'
