# BaaS API image. Runs the Express/tRPC server + BullMQ workers + crons.
# It orchestrates tenant stacks by shelling out to `docker`/`docker compose`
# against the host daemon (socket is bind-mounted at runtime), so the image
# ships the Docker CLI + compose plugin.
FROM node:20-bookworm-slim

# Docker CLI + compose plugin (from the official docker cli image).
COPY --from=docker:27-cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker:27-cli /usr/local/libexec/docker/cli-plugins/docker-compose /usr/local/libexec/docker/cli-plugins/docker-compose

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /app

# Install deps with the full workspace manifest set for good layer caching.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml turbo.json tsconfig.base.json ./
COPY packages/database/package.json packages/database/
COPY packages/scheduler/package.json packages/scheduler/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile

# Source.
COPY packages/database packages/database
COPY packages/scheduler packages/scheduler
COPY apps/api apps/api

EXPOSE 4001
CMD ["pnpm", "--filter", "@guildserver/baas-api", "start"]
