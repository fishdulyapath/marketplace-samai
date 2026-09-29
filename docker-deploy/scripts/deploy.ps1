param(
    [switch]$SkipBuild,
    [switch]$InstallDependencies
)

$ErrorActionPreference = "Stop"

$DeployDir = Resolve-Path (Join-Path $PSScriptRoot "..")
$ComposeFile = Join-Path $DeployDir "docker-compose.yaml"
$ComposeEnv = Join-Path $DeployDir ".env"

function Get-DotEnvValue {
    param(
        [string]$Path,
        [string]$Name,
        [string]$DefaultValue
    )

    $Match = Get-Content $Path | Select-String -Pattern "^$Name="
    if (-not $Match) {
        return $DefaultValue
    }
    $Value = $Match[0].ToString().Split("=", 2)[1].Trim()
    if (-not $Value) {
        return $DefaultValue
    }
    return $Value
}

if (-not (Test-Path $ComposeEnv)) {
    throw "Missing docker-deploy\.env. Copy docker-deploy\.env.example to docker-deploy\.env and edit it first."
}

if (-not $SkipBuild) {
    if ($InstallDependencies) {
        & (Join-Path $PSScriptRoot "build.ps1")
    } else {
        & (Join-Path $PSScriptRoot "build.ps1") -SkipNpmCi
    }
    if ($LASTEXITCODE -ne 0) {
        throw "Build failed."
    }
}

docker compose -f $ComposeFile --env-file $ComposeEnv up -d --force-recreate --remove-orphans
if ($LASTEXITCODE -ne 0) {
    throw "Docker compose up failed."
}

$WebPort = Get-DotEnvValue -Path $ComposeEnv -Name "HOST_WEB_PORT" -DefaultValue "88"

Write-Host "Deploy completed."
Write-Host "Web: http://127.0.0.1:$WebPort/app/"
