param(
    [string]$Image = "minorsoft/marketplacesamai-api",
    [string]$Tag = "latest"
)

$ErrorActionPreference = "Stop"

$DeployDir = Resolve-Path (Join-Path $PSScriptRoot "..")
$RootDir = Resolve-Path (Join-Path $DeployDir "..")
$BackendDir = Join-Path $RootDir "MarketPlaceWebServiceExpress"
$FullImage = "${Image}:${Tag}"

Push-Location $BackendDir
try {
    docker build -t $Image .
    docker tag $Image $FullImage
    docker push $FullImage
} finally {
    Pop-Location
}

Write-Host "Published $FullImage"
