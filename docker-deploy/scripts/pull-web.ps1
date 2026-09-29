param(
    [string]$Image = "minorsoft/marketplacesamai",
    [string]$Tag = "latest"
)

$ErrorActionPreference = "Stop"

$FullImage = "${Image}:${Tag}"
docker pull $FullImage

Write-Host "Pulled $FullImage"
