# Deployment Guide

## Main files

- `docker-deploy/docker-compose.yaml`: production-ish compose for API, web, and nginx.
- `docker-deploy/nginx.conf`: nginx config for serving the web container and proxying as configured.
- `docker-deploy/.env.example`: deploy env template. Do not copy real `.env` values into responses.
- `docker-deploy/frontend.env.example`: frontend build-time env template.
- `docker-deploy/sql/001_marketplace_bootstrap.sql`: marketplace-specific bootstrap objects.
- `docker-deploy/scripts/*.ps1`: build, deploy, migrate, publish, and pull helpers.

## Compose services

- `marketplace-api`
  - Image default: `minorsoft/marketplacelanboon-api:latest`.
  - Container port: `47300`.
  - Uses external Docker network `sml_service_network`.
  - Mounts `./data/content` and `./data/media`.
  - Healthcheck: `http://127.0.0.1:47300/health`.
- `marketplace-web`
  - Image default: `minorsoft/marketplacelanboon:latest`.
  - Depends on healthy API.
- `nginx`
  - Exposes `${HOST_PORT:-8001}:80`.

## Deployment commands

Work from `docker-deploy`.

```powershell
.\scripts\migrate.ps1
.\scripts\deploy.ps1
.\scripts\deploy.ps1 -InstallDependencies
.\scripts\publish-all.ps1
.\scripts\publish-all.ps1 -SkipNpmCi
docker compose -f .\docker-compose.yaml --env-file .\.env ps
docker compose -f .\docker-compose.yaml --env-file .\.env logs -f marketplace-api
```

Ask before running commands that push images, modify remote servers, or mutate production databases.

## Port and URL checks

- Backend code default: `PORT=47300`.
- API base path: `/service/v1`.
- Health path: `/health`.
- Swagger UI: `/api-docs`.
- Frontend `VITE_APP_API` must point to a browser-reachable backend base URL and usually should include a trailing slash if existing service code expects one.
- Frontend `VITE_APP_BASE_URL` must match the virtual path when served below a subpath.

## Runtime data

Back up these directories before migration or host changes:

- `docker-deploy/data/content`
- `docker-deploy/data/media`

These are runtime volumes, not baked into the Docker image.
