param(
    [switch]$SkipNpmCi,
    [switch]$SkipDockerBuild
)

$ErrorActionPreference = "Stop"

$DeployDir = Resolve-Path (Join-Path $PSScriptRoot "..")
$RootDir = Resolve-Path (Join-Path $DeployDir "..")
$FrontendDir = Join-Path $RootDir "MarketPlaceWeb"
$ComposeFile = Join-Path $DeployDir "docker-compose.yaml"
$ComposeEnv = Join-Path $DeployDir ".env"
$FrontendEnv = Join-Path $DeployDir "frontend.env"
$FrontendEnvTarget = Join-Path $FrontendDir ".env.production.local"

if (-not (Test-Path $ComposeEnv)) {
    throw "Missing docker-deploy\.env. Copy docker-deploy\.env.example to docker-deploy\.env and edit it first."
}

if (Test-Path $FrontendEnv) {
    Copy-Item $FrontendEnv $FrontendEnvTarget -Force
    Write-Host "Copied frontend.env to MarketPlaceWeb\.env.production.local"
} else {
    Write-Warning "docker-deploy\frontend.env not found. Vite will use MarketPlaceWeb\.env for the frontend build."
}

Push-Location $FrontendDir
try {
    $NodeModulesPath = Join-Path $FrontendDir "node_modules"
    if ((-not $SkipNpmCi) -or (-not (Test-Path $NodeModulesPath))) {
        npm.cmd ci
        if ($LASTEXITCODE -ne 0) {
            throw "npm ci failed."
        }
    } else {
        Write-Host "Skipped npm ci because node_modules already exists."
    }
    npm.cmd run build
    if ($LASTEXITCODE -ne 0) {
        throw "npm run build failed."
    }
} finally {
    Pop-Location
}

if (-not $SkipDockerBuild) {
    docker compose -f $ComposeFile --env-file $ComposeEnv build
    if ($LASTEXITCODE -ne 0) {
        throw "Docker compose build failed."
    }
}

Write-Host "Build completed."
