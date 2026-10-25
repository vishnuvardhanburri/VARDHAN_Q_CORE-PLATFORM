# ===================================================================
# VARDHAN Q-CORE — Intelligence Plane Frontend Image
# Build context is the repository root so the local TypeScript SDK
# dependency (../sdks/typescript/vardhan-qcore) is available.
# ===================================================================

FROM node:22-bookworm AS builder
WORKDIR /workspace

# Build the local SDK first: its package.json points consumers to dist/.
COPY sdks/typescript/vardhan-qcore/ ./sdks/typescript/vardhan-qcore/
WORKDIR /workspace/sdks/typescript/vardhan-qcore
RUN npm ci && npm run build

# Install the frontend from the lockfile; the sibling SDK path is now present.
WORKDIR /workspace/intelligence_plane
COPY intelligence_plane/package.json intelligence_plane/package-lock.json ./
RUN npm ci

# Add frontend source after dependency installation for cache efficiency.
COPY intelligence_plane/ ./
ARG VITE_API_URL=http://localhost:8080
ENV VITE_API_URL=${VITE_API_URL}
RUN npm run build

# Runtime contains only the built static frontend and its hardened server.
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
COPY --from=builder --chown=node:node /workspace/intelligence_plane/dist ./dist
COPY --chown=node:node intelligence_plane/server.cjs ./server.cjs
ENV NODE_ENV=production
EXPOSE 3000
USER node
CMD ["node", "server.cjs"]
