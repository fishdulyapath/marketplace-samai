param(
    [string]$Image = "minorsoft/marketplaceasia",
    [string]$Tag = "latest"
)

$ErrorActionPreference = "Stop"

$FullImage = "${Image}:${Tag}"
docker pull $FullImage

Write-Host "Pulled $FullImage"

