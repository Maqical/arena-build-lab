param(
  [int]$DurationSeconds = 900,
  [int]$IntervalMilliseconds = 1000
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$captureRoot = Join-Path $PSScriptRoot "..\logs\augment-capture.local"
$captureRoot = [System.IO.Path]::GetFullPath($captureRoot)
[System.IO.Directory]::CreateDirectory($captureRoot) | Out-Null
$latestPath = Join-Path $captureRoot "latest.jpg"
$manifestPath = Join-Path $captureRoot "manifest.ndjson"
$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$jpegCodec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object MimeType -eq "image/jpeg"
$encoder = [System.Drawing.Imaging.Encoder]::Quality
$encoderParameters = New-Object System.Drawing.Imaging.EncoderParameters 1
$encoderParameters.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter $encoder, ([long]55)
$startedAt = [DateTimeOffset]::UtcNow
$nextArchive = [DateTimeOffset]::UtcNow

while (([DateTimeOffset]::UtcNow - $startedAt).TotalSeconds -lt $DurationSeconds) {
  $bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
    $bitmap.Save($latestPath, $jpegCodec, $encoderParameters)
    $now = [DateTimeOffset]::UtcNow
    if ($now -ge $nextArchive) {
      $stamp = $now.ToString("yyyyMMdd-HHmmss")
      $archivePath = Join-Path $captureRoot "$stamp.jpg"
      $bitmap.Save($archivePath, $jpegCodec, $encoderParameters)
      @{ timestamp = $now.ToString("o"); file = [System.IO.Path]::GetFileName($archivePath); width = $bounds.Width; height = $bounds.Height } |
        ConvertTo-Json -Compress | Add-Content -LiteralPath $manifestPath
      $nextArchive = $now.AddSeconds(3)
    }
  } finally {
    $graphics.Dispose()
    $bitmap.Dispose()
  }
  Start-Sleep -Milliseconds $IntervalMilliseconds
}

$encoderParameters.Dispose()
