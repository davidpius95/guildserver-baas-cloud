---
name: deploy
description: Deploy guildserver-baas-cloud to the production server. Use when asked to deploy, ship, push to the server, or release the BaaS platform. Primary path triggers the GitHub Actions deploy workflow; includes a manual SSH fallback.
---

# Deploy guildserver-baas-cloud

The server (`143.105.102.121:5555`, user `usher-node`) runs the live GuildServer PaaS
stack **plus** this BaaS platform. Deploys must only touch the BaaS stack
(`baas-postgres`, `baas-redis`, `baas-imgproxy`, `baas-api`, `baas-web`) and never the
`guildserver-*` PaaS/monitoring containers, Portainer (`gs-po-*`), or `hermes-*`.

## Primary path — GitHub Actions (recommended)

Every push to `main` auto-deploys via `.github/workflows/deploy.yml`. To deploy the
current committed state:

1. Ensure work is committed and pushed:
   ```bash
   git push origin main
   ```
2. Or trigger a redeploy of the current `main` without a new commit:
   ```bash
   gh workflow run deploy.yml
   gh run watch $(gh run list --workflow=deploy.yml --limit=1 --json databaseId -q '.[0].databaseId')
   ```
3. Confirm health: the workflow curls `http://localhost:4001/health` on the server and
   fails if it doesn't come up.

The workflow SSHes in, `git reset --hard origin/main`, `pnpm install --frozen-lockfile`,
`pnpm db:migrate`, `docker compose up -d --build`, then health-checks.

## Manual fallback (when CI is unavailable)

SSH in with your own credentials and run the same steps the workflow runs:

```bash
ssh -p 5555 usher-node@143.105.102.121
cd ~/guildserver-baas-cloud
git fetch --prune origin main && git reset --hard origin/main
pnpm install --frozen-lockfile
pnpm db:migrate
docker compose up -d --build
curl -fsS http://localhost:4001/health && echo OK
```

## Safety checks

- Before deploying, confirm you're not about to disrupt PaaS: `docker ps --format '{{.Names}}' | grep -E 'guildserver-(api|web|traefik|postgres|redis)'` should still list them after deploy.
- `.env` lives only on the server (never committed). If a new env var is added to
  `.env.example`, add it to the server `.env` before deploying or the API may fail to boot
  (e.g. it refuses to start without a valid `BAAS_ENCRYPTION_KEY`).
- Migrations are additive; if `pnpm db:migrate` fails, the stack is not rebuilt — fix the
  migration and re-run rather than forcing containers up.
