# Signal Room web app — static build served by nginx.
# The web app talks directly to SpacetimeDB maincloud over WSS; the agent gateway
# (apps/gateway) is a separate process and is NOT part of this image.
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app

# Install workspace deps (lockfile-pinned) for the web package.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY apps/gateway/package.json apps/gateway/package.json
COPY apps/spacetime/spacetimedb/package.json apps/spacetime/spacetimedb/package.json
RUN pnpm install --frozen-lockfile

# Build only the web app.
COPY . .
ARG VITE_SPACETIME_URI
ARG VITE_SPACETIME_DATABASE
ARG VITE_GATEWAY_URL
RUN pnpm --dir apps/web build

FROM nginx:alpine AS runtime
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
