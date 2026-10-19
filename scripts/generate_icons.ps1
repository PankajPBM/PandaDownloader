Add-Type -AssemblyName System.Drawing
$srcPath = "d:\Pankaj\Project\Panda Downloader\assets\icon.png"
$src = [System.Drawing.Bitmap]::FromFile($srcPath)
$iconDir = "d:\Pankaj\Project\Panda Downloader\extension\icons"
if (-not (Test-Path $iconDir)) {
    New-Item -ItemType Directory -Path $iconDir -Force | Out-Null
}

$sizes = 16, 32, 48, 128
foreach ($sz in $sizes) {
    $bmp = New-Object System.Drawing.Bitmap $sz, $sz
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.DrawImage($src, 0, 0, $sz, $sz)
    $g.Dispose()
    $outPath = Join-Path $iconDir ("icon" + $sz + ".png")
    $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Host "Generated: $outPath"
}
$src.Dispose()
