param(
    [string]$Image = "minorsoft/marketplacesamai-api",
    [string]$Tag = "latest"
)

$ErrorActionPreference = "Stop"

$FullImage = "${Image}:${Tag}"
docker pull $FullImage

Write-Host "Pulled $FullImage"
