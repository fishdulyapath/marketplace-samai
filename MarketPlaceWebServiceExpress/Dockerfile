# syntax=docker/dockerfile:1
FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV MARKETPLACE_DATA_DIR=/app/data
ENV MARKETPLACE_CONTENT_DIR=/app/data/content
ENV MARKETPLACE_MEDIA_DIR=/app/data/media
RUN apk add --no-cache wget
COPY --from=deps /app/node_modules ./node_modules
COPY package*.json ./
COPY src ./src
COPY docs ./docs
RUN mkdir -p /app/data/content /app/data/media && chown -R node:node /app/data
EXPOSE 47300
VOLUME ["/app/data/content", "/app/data/media"]
USER node
CMD ["node", "src/index.js"]
