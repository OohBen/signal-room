# Signal Room agent gateway — Node service that holds secrets, calls OpenAI/OpenRouter/Exa,
# and writes back to SpacetimeDB maincloud via the `spacetime` CLI.
FROM node:22-slim AS build
RUN corepack enable
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/gateway/package.json apps/gateway/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/spacetime/spacetimedb/package.json apps/spacetime/spacetimedb/package.json
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --dir apps/gateway build

FROM node:22-slim AS runtime
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates ffmpeg bash \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable
# Install the SpacetimeDB CLI (used for reducer calls + SQL reads).
RUN curl -sSf https://install.spacetimedb.com | bash -s -- --yes
ENV PATH="/root/.local/bin:${PATH}"
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/gateway/node_modules ./apps/gateway/node_modules
COPY --from=build /app/apps/gateway/dist ./apps/gateway/dist
COPY --from=build /app/apps/gateway/package.json ./apps/gateway/package.json
COPY --from=build /app/package.json ./package.json
COPY apps/gateway/docker-entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh
ENV PORT=8787
EXPOSE 8787
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
