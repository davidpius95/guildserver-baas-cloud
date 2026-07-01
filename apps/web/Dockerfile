# BaaS dashboard (Next.js). Client components call the API at NEXT_PUBLIC_BAAS_API_URL,
# which is baked at build time — same origin as the dashboard (cloud.guildserver.io),
# so the browser hits /trpc on the same host (traefik routes /trpc to the API).
FROM node:20-bookworm-slim AS builder

ARG NEXT_PUBLIC_BAAS_API_URL=https://cloud.guildserver.io
ENV NEXT_PUBLIC_BAAS_API_URL=$NEXT_PUBLIC_BAAS_API_URL
ENV NEXT_TELEMETRY_DISABLED=1

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

# Workspace manifests for a cache-friendly install.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml turbo.json tsconfig.base.json ./
COPY packages/database/package.json packages/database/
COPY packages/scheduler/package.json packages/scheduler/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile

COPY apps/web apps/web
RUN pnpm --filter @guildserver/baas-web build

FROM node:20-bookworm-slim AS runner
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=builder /app/node_modules /app/node_modules
COPY --from=builder /app/package.json /app/pnpm-workspace.yaml /app/
COPY --from=builder /app/apps/web /app/apps/web

EXPOSE 3001
CMD ["pnpm", "--filter", "@guildserver/baas-web", "start"]
