# Builds dist/SnapShift-<version>.zip with only the files the extension needs.
# Writes entries with forward slashes (Compress-Archive on Windows PowerShell 5.1
# uses backslashes, which the Chrome Web Store can reject).
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem

$version = (Get-Content manifest.json -Raw | ConvertFrom-Json).version
$files = @('manifest.json', 'background.js', 'store.js', 'popup.html', 'popup.js', 'preview.html', 'preview.js') +
  (Get-ChildItem icons -Filter *.png | ForEach-Object { "icons/$($_.Name)" })

New-Item -ItemType Directory dist -Force | Out-Null
$zipPath = Join-Path $PSScriptRoot "dist/SnapShift-$version.zip"
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

$zip = [IO.Compression.ZipFile]::Open($zipPath, 'Create')
try {
  foreach ($f in $files) {
    [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, (Join-Path $PSScriptRoot $f), $f, 'Optimal') | Out-Null
  }
} finally { $zip.Dispose() }
Write-Host "Built dist/SnapShift-$version.zip ($($files.Count) files)"
