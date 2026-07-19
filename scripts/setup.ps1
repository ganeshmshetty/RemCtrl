$ErrorActionPreference = 'Stop'

function Stop-WithError([string]$Message) {
    Write-Error "Error: $Message"
    exit 1
}

$RootDir = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $RootDir

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Stop-WithError 'Node.js is required. Install Node.js (which includes npm), then run this script again.'
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Stop-WithError 'npm is required but was not found. Install Node.js with npm, then run this script again.'
}
if (-not (Test-Path -LiteralPath (Join-Path $RootDir 'package.json') -PathType Leaf)) {
    Stop-WithError "package.json was not found at $RootDir. Run this script from a project checkout."
}

Write-Host "Using Node $(node --version)"
Write-Host "Using npm $(npm --version)"

if ((Test-Path -LiteralPath (Join-Path $RootDir 'package-lock.json') -PathType Leaf) -or
    (Test-Path -LiteralPath (Join-Path $RootDir 'npm-shrinkwrap.json') -PathType Leaf)) {
    Write-Host 'Installing dependencies with npm ci...'
    & npm ci
} else {
    Write-Host 'No npm lockfile found; installing dependencies with npm install...'
    & npm install
}
if ($LASTEXITCODE -ne 0) {
    Stop-WithError 'Dependency installation failed. Review the npm output and try again.'
}

$ExampleEnv = Join-Path $RootDir '.env.example'
$LocalEnv = Join-Path $RootDir '.env'
if ((Test-Path -LiteralPath $ExampleEnv -PathType Leaf) -and
    -not (Test-Path -LiteralPath $LocalEnv)) {
    Copy-Item -LiteralPath $ExampleEnv -Destination $LocalEnv
    Write-Host 'Created .env from .env.example.'
} elseif (Test-Path -LiteralPath $LocalEnv) {
    Write-Host 'Keeping existing .env path unchanged.'
} else {
    Write-Host 'No .env.example found; leaving environment files unchanged.'
}

Write-Host ''
Write-Host 'Setup complete. Next commands:'
Write-Host '  npm run dev'
Write-Host '  npm run test'
