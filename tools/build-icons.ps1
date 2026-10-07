# tools/icon.html を Chrome で描画し、PWA 用のアイコン（icons/*.png）を作る。
#   powershell -ExecutionPolicy Bypass -File tools\build-icons.ps1

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$Root = Split-Path -Parent $PSScriptRoot
$IconDir = Join-Path $Root 'icons'
New-Item -ItemType Directory -Force $IconDir | Out-Null

$chrome = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $chrome) { throw 'Chrome または Edge が見つかりません' }

$source = Join-Path $env:TEMP 'west-diary-icon-1024.png'
$html = 'file:///' + (Join-Path $PSScriptRoot 'icon.html').Replace([char]92, [char]47)
# Chrome は進捗を標準エラーに出すので、ここだけエラー扱いにしない
$ErrorActionPreference = 'Continue'
& $chrome --headless=new --disable-gpu --hide-scrollbars --window-size=1024,1024 "--screenshot=$source" $html 2>&1 | Out-Null
$ErrorActionPreference = 'Stop'
Start-Sleep -Milliseconds 500
if (-not (Test-Path $source)) { throw 'アイコンを描画できませんでした' }

$sizes = [ordered]@{ 'icon-512.png' = 512; 'icon-192.png' = 192; 'apple-touch-icon.png' = 180 }
$img = [System.Drawing.Image]::FromFile($source)
try {
  foreach ($name in $sizes.Keys) {
    $size = $sizes[$name]
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.DrawImage($img, 0, 0, $size, $size)
    $g.Dispose()
    $bmp.Save((Join-Path $IconDir $name), [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Host "作成: icons/$name"
  }
} finally {
  $img.Dispose()
  Remove-Item $source
}
