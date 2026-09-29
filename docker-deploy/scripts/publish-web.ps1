param(
    [string]$Image = "minorsoft/marketplacesamai",
    [string]$Tag = "latest",
    [switch]$SkipNpmCi
)

$ErrorActionPreference = "Stop"

$DeployDir = Resolve-Path (Join-Path $PSScriptRoot "..")
$RootDir = Resolve-Path (Join-Path $DeployDir "..")
$FrontendDir = Join-Path $RootDir "MarketPlaceWeb"
$FrontendEnv = Join-Path $DeployDir "frontend.env"
$FrontendEnvTarget = Join-Path $FrontendDir ".env.production.local"
$FullImage = "${Image}:${Tag}"

if (Test-Path $FrontendEnv) {
    Copy-Item $FrontendEnv $FrontendEnvTarget -Force
    Write-Host "Copied frontend.env to MarketPlaceWeb\.env.production.local"
} else {
    Write-Warning "docker-deploy\frontend.env not found. Vite will use MarketPlaceWeb\.env for the frontend build."
}

Push-Location $FrontendDir
try {
    if (-not $SkipNpmCi) {
        npm.cmd ci
    }
    npm.cmd run build

    docker build -t $Image .
    docker tag $Image $FullImage
    docker push $FullImage
} finally {
    Pop-Location
}

Write-Host "Published $FullImage"
