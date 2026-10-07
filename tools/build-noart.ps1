# ジャケ写なし版のページ noart/index.html を、index.html から作る。
#   - <html data-artwork="off"> でジャケット画像を出さない（app.js の SHOW_ARTWORK）
#   - <base href="../"> で CSS・JS・カタログ・アイコン・sw.js は本体のものを使う
#   - マニフェストだけ noart/manifest.webmanifest（開始 URL が noart/）を使う
# index.html を変えたら再実行する。
#   powershell -ExecutionPolicy Bypass -File tools\build-noart.ps1

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$utf8 = New-Object Text.UTF8Encoding $false

$html = [IO.File]::ReadAllText((Join-Path $Root 'index.html'), $utf8)
$replacements = [ordered]@{
  '<html lang="ja">'                            = '<html lang="ja" data-artwork="off">'
  '<meta charset="UTF-8">'                      = "<meta charset=""UTF-8"">`n  <!-- tools/build-noart.ps1 で index.html から作るページ。直接編集しない -->`n  <base href=""../"">"
  '<link rel="manifest" href="manifest.webmanifest">' = '<link rel="manifest" href="noart/manifest.webmanifest">'
}
foreach ($from in $replacements.Keys) {
  if (-not $html.Contains($from)) { throw "index.html に見つかりません: $from" }
  $html = $html.Replace($from, $replacements[$from])
}

$outDir = Join-Path $Root 'noart'
New-Item -ItemType Directory -Force $outDir | Out-Null
[IO.File]::WriteAllText((Join-Path $outDir 'index.html'), $html, $utf8)
Write-Host '完了: noart/index.html'
