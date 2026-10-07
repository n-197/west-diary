# WEST. の作品カタログ（作品名・発売日・収録曲・ジャケット画像）を iTunes から取得し、次の 2 つを作る。
#   - catalog.json             … PWA 版用。ジャケットは Apple の画像 URL、曲ごとに 30 秒試聴 URL を持つ
#   - claude-page/catalog.json … claude.ai 公開版用。ジャケット画像は claude-page/art/ に同梱する
# 新しい作品が出たら再実行して、PWA 版（GitHub Pages）と claude-page を公開し直す。
#   powershell -ExecutionPolicy Bypass -File tools\build-catalog.ps1

$ErrorActionPreference = 'Stop'
$ArtistId = 1835325063  # iTunes 上の WEST.
$Root = Split-Path -Parent $PSScriptRoot
$OutDir = Join-Path $Root 'claude-page'
$ArtDir = Join-Path $OutDir 'art'
New-Item -ItemType Directory -Force $ArtDir | Out-Null

# 曲数が少なくてもアルバムとして扱う作品
$AlbumOverrides = @('パリピポ')

function Clean-Name([string]$name) {
  return ($name -replace ' \(2025\)', '' -replace ' - (EP|Single)$', '').Trim()
}

function To-JstDate([string]$iso) {
  return ([DateTimeOffset]::Parse($iso)).ToOffset([TimeSpan]::FromHours(9)).ToString('yyyy-MM-dd')
}

function Write-Json([string]$path, $works) {
  $json = [ordered]@{ updatedAt = (Get-Date -Format 'yyyy-MM-dd'); works = $works } | ConvertTo-Json -Depth 6 -Compress
  [System.IO.File]::WriteAllText($path, $json, (New-Object System.Text.UTF8Encoding $false))
}

$lookup = Invoke-RestMethod "https://itunes.apple.com/lookup?id=$ArtistId&entity=album&limit=200&country=jp&lang=ja_jp"
$collections = $lookup.results | Where-Object { $_.wrapperType -eq 'collection' } | Sort-Object releaseDate

$pwaWorks = @()
$pageWorks = @()
foreach ($c in $collections) {
  $name = Clean-Name $c.collectionName
  Write-Host "取得中: $name"

  # 曲名と 30 秒試聴 URL（同じ曲名が複数あれば最初の 1 曲）
  $tracks = Invoke-RestMethod "https://itunes.apple.com/lookup?id=$($c.collectionId)&entity=song&country=jp&lang=ja_jp"
  $songs = @()
  $seen = @{}
  foreach ($t in ($tracks.results | Where-Object { $_.wrapperType -eq 'track' } | Sort-Object discNumber, trackNumber)) {
    $title = $t.trackName -replace ' \(20\d\d\)$', ''
    if ($seen.ContainsKey($title)) { continue }
    $seen[$title] = $true
    $songs += [ordered]@{
      title   = $title
      preview = $(if ($t.previewUrl -like 'https://*') { $t.previewUrl } else { '' })
    }
  }

  $artUrl = $c.artworkUrl100 -replace '\d+x\d+bb', '300x300bb'
  $art = "art/$($c.collectionId).jpg"
  $artPath = Join-Path $OutDir $art
  if (-not (Test-Path $artPath)) {
    Invoke-WebRequest $artUrl -OutFile $artPath -UseBasicParsing
  }

  $isAlbum = ($c.trackCount -ge 9) -or ($AlbumOverrides -contains $name)
  $base = [ordered]@{
    id          = [string]$c.collectionId
    name        = $name
    category    = $(if ($isAlbum) { 'album' } else { 'single' })
    releaseDate = To-JstDate $c.releaseDate
  }
  $pwa = [ordered]@{} + $base
  $pwa.artwork = $artUrl
  $pwa.songs = $songs
  $pwaWorks += $pwa
  $page = [ordered]@{} + $base
  $page.artwork = $art
  $page.songs = @($songs | ForEach-Object { $_.title })
  $pageWorks += $page
  Start-Sleep -Milliseconds 300  # API への連続アクセスを控えめにする
}

Write-Json (Join-Path $Root 'catalog.json') $pwaWorks
Write-Json (Join-Path $OutDir 'catalog.json') $pageWorks
Write-Host "完了: $($pwaWorks.Count) 作品"
