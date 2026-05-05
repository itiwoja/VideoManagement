# PWA icon generator. Outputs icon-192.png and icon-512.png in this folder.
# Run: powershell -ExecutionPolicy Bypass -File generate-pwa-icons.ps1

Add-Type -AssemblyName System.Drawing

function New-Icon([int]$size, [string]$path) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.Color]::FromArgb(255, 24, 24, 27))

    $rectSize = [int]($size * 0.7)
    $rectOffset = [int](($size - $rectSize) / 2)
    $brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 244, 244, 245))
    $rect = New-Object System.Drawing.Rectangle $rectOffset, $rectOffset, $rectSize, $rectSize
    $g.FillRectangle($brush, $rect)

    $triangleBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 24, 24, 27))
    $cx = $size / 2.0
    $cy = $size / 2.0
    $tri = $size * 0.18
    $points = @(
        New-Object System.Drawing.PointF([float]($cx - $tri * 0.5), [float]($cy - $tri))
        New-Object System.Drawing.PointF([float]($cx - $tri * 0.5), [float]($cy + $tri))
        New-Object System.Drawing.PointF([float]($cx + $tri),       [float]$cy)
    )
    $g.FillPolygon($triangleBrush, $points)

    $g.Dispose()
    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Host "wrote $path"
}

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
New-Icon 192 (Join-Path $here 'icon-192.png')
New-Icon 512 (Join-Path $here 'icon-512.png')
