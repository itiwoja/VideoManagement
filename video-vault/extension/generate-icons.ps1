# Simple PNG icon generator. Generates icon-{16,48,128}.png in the same dir.
# Run: powershell -ExecutionPolicy Bypass -File generate-icons.ps1

Add-Type -AssemblyName System.Drawing

function New-Icon([int]$size, [string]$path) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.Color]::FromArgb(255, 24, 24, 27)) # zinc-900

    # Rounded rectangle (mock with filled rect at smaller size)
    $rectSize = [int]($size * 0.7)
    $rectOffset = [int](($size - $rectSize) / 2)
    $brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 244, 244, 245)) # zinc-100
    $rect = New-Object System.Drawing.Rectangle $rectOffset, $rectOffset, $rectSize, $rectSize
    $g.FillRectangle($brush, $rect)

    # play triangle
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
New-Icon  16 (Join-Path $here 'icon-16.png')
New-Icon  48 (Join-Path $here 'icon-48.png')
New-Icon 128 (Join-Path $here 'icon-128.png')
