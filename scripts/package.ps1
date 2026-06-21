$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

node scripts/validate.mjs

$Output = Join-Path $Root "bilibili-vocab-assistant.zip"
if (Test-Path $Output) {
    Remove-Item -LiteralPath $Output -Force
}

Compress-Archive -Path (Join-Path $Root "dist\*") -DestinationPath $Output
Write-Host "Created $Output"
