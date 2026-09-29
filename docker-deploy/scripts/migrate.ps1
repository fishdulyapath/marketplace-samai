param(
    [string]$EnvFile = "",
    [string]$SqlFile = ""
)

$ErrorActionPreference = "Stop"

function Import-DotEnv {
    param([string]$Path)

    if (-not (Test-Path $Path)) {
        throw "Missing env file: $Path"
    }

    Get-Content $Path | ForEach-Object {
        $Line = $_.Trim()
        if (-not $Line -or $Line.StartsWith("#")) {
            return
        }
        $Parts = $Line.Split("=", 2)
        if ($Parts.Count -ne 2) {
            return
        }
        $Name = $Parts[0].Trim()
        $Value = $Parts[1].Trim().Trim('"').Trim("'")
        [Environment]::SetEnvironmentVariable($Name, $Value, "Process")
    }
}

$DeployDir = Resolve-Path (Join-Path $PSScriptRoot "..")
$DefaultEnv = Join-Path $DeployDir ".env"
$DefaultSql = Join-Path $DeployDir "sql\001_marketplace_bootstrap.sql"

if (-not $EnvFile) {
    $EnvFile = $DefaultEnv
}
if (-not $SqlFile) {
    $SqlFile = $DefaultSql
}

Import-DotEnv $EnvFile

$Required = @("DB_HOST", "DB_PORT", "DB_USER", "DB_PASSWORD", "DB_NAME")
foreach ($Key in $Required) {
    if (-not [Environment]::GetEnvironmentVariable($Key, "Process")) {
        throw "Missing $Key in $EnvFile"
    }
}

$SqlPath = Resolve-Path $SqlFile
$SqlDir = Split-Path $SqlPath
$SqlName = Split-Path $SqlPath -Leaf

docker run --rm `
    -e "PGPASSWORD=$env:DB_PASSWORD" `
    -v "${SqlDir}:/sql:ro" `
    postgres:16-alpine `
    psql `
    -h $env:DB_HOST `
    -p $env:DB_PORT `
    -U $env:DB_USER `
    -d $env:DB_NAME `
    -v ON_ERROR_STOP=1 `
    -f "/sql/$SqlName"

Write-Host "Migration completed."

