Add-Type -AssemblyName System.Drawing

$assetsDir = "d:\Pankaj\Project\Panda Downloader\assets"
if (-not (Test-Path $assetsDir)) {
    New-Item -ItemType Directory -Path $assetsDir -Force | Out-Null
}

function Create-PandaBitmap([int]$size) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

    $scale = $size / 256.0

    # Background rounded container
    $bgBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        (New-Object System.Drawing.PointF(0, 0)),
        (New-Object System.Drawing.PointF($size, $size)),
        [System.Drawing.Color]::FromArgb(255, 13, 19, 34),
        [System.Drawing.Color]::FromArgb(255, 7, 10, 18)
    )
    $bgRect = New-Object System.Drawing.RectangleF((8 * $scale), (8 * $scale), (240 * $scale), (240 * $scale))
    
    # Draw circular glowing base
    $g.FillEllipse($bgBrush, $bgRect)
    
    # Outer glow ring
    $glowPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 16, 185, 129), (6 * $scale))
    $g.DrawEllipse($glowPen, $bgRect)

    # Secondary inner ring
    $innerGlowPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(120, 6, 182, 212), (2 * $scale))
    $innerRect = New-Object System.Drawing.RectangleF((14 * $scale), (14 * $scale), (228 * $scale), (228 * $scale))
    $g.DrawEllipse($innerGlowPen, $innerRect)

    # Panda Ears
    $earBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 20, 24, 38))
    $g.FillEllipse($earBrush, (50 * $scale), (45 * $scale), (52 * $scale), (52 * $scale))
    $g.FillEllipse($earBrush, (154 * $scale), (45 * $scale), (52 * $scale), (52 * $scale))

    # Ear inner ring
    $earInnerPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(200, 16, 185, 129), (3 * $scale))
    $g.DrawEllipse($earInnerPen, (58 * $scale), (53 * $scale), (36 * $scale), (36 * $scale))
    $g.DrawEllipse($earInnerPen, (162 * $scale), (53 * $scale), (36 * $scale), (36 * $scale))

    # Panda Head Base
    $headBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 248, 250, 252))
    $g.FillEllipse($headBrush, (48 * $scale), (70 * $scale), (160 * $scale), (140 * $scale))

    # Panda Eye Patches (Angled ellipses)
    $patchBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 24, 32, 47))
    
    # Left eye patch
    $g.TranslateTransform((88 * $scale), (125 * $scale))
    $g.RotateTransform(-20)
    $g.FillEllipse($patchBrush, (-24 * $scale), (-30 * $scale), (48 * $scale), (60 * $scale))
    $g.RotateTransform(20)
    $g.TranslateTransform((-88 * $scale), (-125 * $scale))

    # Right eye patch
    $g.TranslateTransform((168 * $scale), (125 * $scale))
    $g.RotateTransform(20)
    $g.FillEllipse($patchBrush, (-24 * $scale), (-30 * $scale), (48 * $scale), (60 * $scale))
    $g.RotateTransform(-20)
    $g.TranslateTransform((-168 * $scale), (-125 * $scale))

    # Glowing Pupils (Emerald/Cyan)
    $pupilBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 16, 185, 129))
    $g.FillEllipse($pupilBrush, (84 * $scale), (120 * $scale), (14 * $scale), (14 * $scale))
    $g.FillEllipse($pupilBrush, (158 * $scale), (120 * $scale), (14 * $scale), (14 * $scale))

    # Eye spark dots
    $sparkBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 255, 255, 255))
    $g.FillEllipse($sparkBrush, (87 * $scale), (122 * $scale), (5 * $scale), (5 * $scale))
    $g.FillEllipse($sparkBrush, (161 * $scale), (122 * $scale), (5 * $scale), (5 * $scale))

    # Panda Nose
    $noseBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 15, 23, 42))
    $g.FillEllipse($noseBrush, (116 * $scale), (150 * $scale), (24 * $scale), (16 * $scale))

    # Downloader Arrow Symbol (High-Speed Downward Chevron & Arrow)
    $arrowBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        (New-Object System.Drawing.PointF((128 * $scale), (165 * $scale))),
        (New-Object System.Drawing.PointF((128 * $scale), (235 * $scale))),
        [System.Drawing.Color]::FromArgb(255, 16, 185, 129),
        [System.Drawing.Color]::FromArgb(255, 6, 182, 212)
    )

    $arrowPoints = @(
        (New-Object System.Drawing.PointF((114 * $scale), (170 * $scale))),
        (New-Object System.Drawing.PointF((142 * $scale), (170 * $scale))),
        (New-Object System.Drawing.PointF((142 * $scale), (196 * $scale))),
        (New-Object System.Drawing.PointF((158 * $scale), (196 * $scale))),
        (New-Object System.Drawing.PointF((128 * $scale), (226 * $scale))),
        (New-Object System.Drawing.PointF((98 * $scale), (196 * $scale))),
        (New-Object System.Drawing.PointF((114 * $scale), (196 * $scale)))
    )
    $pts = [System.Drawing.PointF[]]$arrowPoints
    $g.FillPolygon($arrowBrush, $pts)

    # Arrow Glow border
    $arrowPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 255, 255, 255), (2 * $scale))
    $g.DrawPolygon($arrowPen, $pts)

    $g.Dispose()
    return $bmp
}

# Generate 256x256 PNG
$bmp256 = Create-PandaBitmap 256
$pngPath = Join-Path $assetsDir "icon.png"
$bmp256.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)
Write-Output "Created $pngPath"

# Generate multi-frame Windows .ICO file
$sizes = @(16, 32, 48, 64, 128, 256)
$pngStreams = @()

foreach ($s in $sizes) {
    $bmp = Create-PandaBitmap $s
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $pngStreams += $ms
    $bmp.Dispose()
}

$icoPath = Join-Path $assetsDir "icon.ico"
$fs = [System.IO.File]::Create($icoPath)
$bw = New-Object System.IO.BinaryWriter($fs)

# ICO Header
$bw.Write([uint16]0) # Reserved
$bw.Write([uint16]1) # Type: 1 for Icon
$bw.Write([uint16]$sizes.Count) # Image count

# Calculate offsets
$headerSize = 6 + ($sizes.Count * 16)
$currentOffset = $headerSize

for ($i = 0; $i -lt $sizes.Count; $i++) {
    $s = $sizes[$i]
    $dataLen = $pngStreams[$i].Length

    $bWidth = if ($s -ge 256) { 0 } else { [byte]$s }
    $bHeight = if ($s -ge 256) { 0 } else { [byte]$s }

    $bw.Write([byte]$bWidth)
    $bw.Write([byte]$bHeight)
    $bw.Write([byte]0) # Color count
    $bw.Write([byte]0) # Reserved
    $bw.Write([uint16]1) # Color planes
    $bw.Write([uint16]32) # Bits per pixel
    $bw.Write([uint32]$dataLen)
    $bw.Write([uint32]$currentOffset)

    $currentOffset += $dataLen
}

# Write image data blocks
for ($i = 0; $i -lt $sizes.Count; $i++) {
    $bytes = $pngStreams[$i].ToArray()
    $bw.Write($bytes)
    $pngStreams[$i].Dispose()
}

$bw.Close()
$fs.Close()
$bmp256.Dispose()

Write-Output "Created $icoPath successfully!"
