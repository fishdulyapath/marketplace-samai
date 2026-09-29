param(
    [string]$Image = "minorsoft/marketplaceasia-api",
    [string]$Tag = "latest"
)

$ErrorActionPreference = "Stop"

$FullImage = "${Image}:${Tag}"
docker pull $FullImage

Write-Host "Pulled $FullImage"

