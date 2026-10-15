# ===================================================================
# VARDHAN Q-CORE — Intelligence Plane Frontend Dockerfile
# ===================================================================
FROM node:22-bookworm AS builder

WORKDIR /app

COPY intelligence_plane/package.json intelligence_plane/package-lock.json* ./
RUN npm ci --frozen-lockfile 2>/dev/null || npm install

COPY intelligence_plane/ ./
RUN npm run build

# Runtime: serve the built assets with a lightweight static server
FROM node:22-bookworm AS runtime
WORKDIR /app
RUN npm install -g serve
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/assets ./assets
EXPOSE 3000
CMD ["serve", "-s", "dist", "-l", "3000"]
