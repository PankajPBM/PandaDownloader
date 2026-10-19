$ErrorActionPreference = "Stop"

Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "  Panda Downloader - Packaging & Installer Builder" -ForegroundColor Cyan
Write-Host "  Publisher: PB Tech Zone (https://prakash77.com.np)" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan

$projectRoot = "d:\Pankaj\Project\Panda Downloader"
$releaseDir = Join-Path $projectRoot "release\PandaDownloader-win32-x64"
$appTarget = Join-Path $releaseDir "resources\app"
$installerDir = Join-Path $projectRoot "installer"
$outputDir = Join-Path $installerDir "Output"

# 1. Build Vite frontend
Write-Host "`n[1/5] Building modern frontend UI..." -ForegroundColor Green
npm run build:renderer

# 2. Prepare release directory
Write-Host "`n[2/5] Staging Electron runtime..." -ForegroundColor Green
if (Test-Path $releaseDir) {
    Remove-Item -Path $releaseDir -Recurse -Force
}
New-Item -ItemType Directory -Path $releaseDir -Force | Out-Null

$electronDist = Join-Path $projectRoot "node_modules\electron\dist"
Copy-Item -Path "$electronDist\*" -Destination $releaseDir -Recurse -Force

# Rename electron.exe to PandaDownloader.exe
$origExe = Join-Path $releaseDir "electron.exe"
$destExe = Join-Path $releaseDir "PandaDownloader.exe"
if (Test-Path $origExe) {
    Rename-Item -Path $origExe -NewName "PandaDownloader.exe"
}

# 3. Copy application files to resources\app
Write-Host "`n[3/5] Bundling application source and engines..." -ForegroundColor Green
New-Item -ItemType Directory -Path $appTarget -Force | Out-Null

Copy-Item -Path (Join-Path $projectRoot "package.json") -Destination $appTarget -Force
Copy-Item -Path (Join-Path $projectRoot "LICENSE") -Destination $appTarget -Force
Copy-Item -Path (Join-Path $projectRoot "dist") -Destination $appTarget -Recurse -Force
Copy-Item -Path (Join-Path $projectRoot "src") -Destination $appTarget -Recurse -Force
Copy-Item -Path (Join-Path $projectRoot "bin") -Destination $appTarget -Recurse -Force
Copy-Item -Path (Join-Path $projectRoot "assets") -Destination $appTarget -Recurse -Force
Copy-Item -Path (Join-Path $projectRoot "extension") -Destination $appTarget -Recurse -Force

# 4. Prepare Output directory
Write-Host "`n[4/5] Preparing installer output directory..." -ForegroundColor Green
if (-not (Test-Path $outputDir)) {
    New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
}

# 5. Compile with Inno Setup
Write-Host "`n[5/5] Compiling final Windows Installer with Inno Setup..." -ForegroundColor Green
$isccPath = "C:\Program Files (x86)\Inno Setup 6\ISCC.exe"
if (-not (Test-Path $isccPath)) {
    $isccPath = "C:\Program Files\Inno Setup 6\ISCC.exe"
}

if (Test-Path $isccPath) {
    $issFile = Join-Path $installerDir "PandaDownloader.iss"
    & $isccPath $issFile
    Write-Host "`n[SUCCESS] Final Installer created at: installer\Output\PandaDownloader_Setup_v1.0.0.exe" -ForegroundColor Cyan
} else {
    Write-Host "`n[WARNING] Inno Setup compiler ISCC.exe not found. Staged release files are ready in release\" -ForegroundColor Yellow
}
