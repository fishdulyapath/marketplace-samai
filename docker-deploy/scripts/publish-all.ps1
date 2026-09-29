param(
    [string]$Tag = "latest",
    [switch]$SkipNpmCi
)

$ErrorActionPreference = "Stop"
$ScriptsDir = $PSScriptRoot

Write-Host "=== Building & pushing API ===" -ForegroundColor Cyan
& "$ScriptsDir\publish-api.ps1" -Tag $Tag

Write-Host "=== Building & pushing Web ===" -ForegroundColor Cyan
if ($SkipNpmCi) {
    & "$ScriptsDir\publish-web.ps1" -Tag $Tag -SkipNpmCi
} else {
    & "$ScriptsDir\publish-web.ps1" -Tag $Tag
}

Write-Host "=== Done ===" -ForegroundColor Green
Write-Host "Run on server: docker compose pull && docker compose up -d --force-recreate"
