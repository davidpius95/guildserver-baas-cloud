---
name: server-ops
description: Read-only diagnostics for the guildserver-baas-cloud production server (docker status, logs, tenants, platform DB). Use when asked to check the server, inspect BaaS containers, tail logs, list tenants, or debug a running deploy.
---

# BaaS server operations (read-only diagnostics)

Server: `ssh -p 5555 usher-node@143.105.102.121`. The box also runs the live GuildServer
PaaS stack — **only inspect BaaS resources**; do not stop/modify `guildserver-*`,
`gs-po-*` (Portainer), or `hermes-*`.

## Naming conventions

- Platform containers: `baas-postgres` (:5434), `baas-redis` (:6379), `baas-imgproxy`, `baas-api` (:4001), `baas-web` (:3001).
- Per-tenant stacks: `baas-{slug}-{service}` (db, kong, auth, rest, realtime, storage, imgproxy, meta, functions, studio [, analytics, vector]).
- Tenant compose files: `/opt/baas-tenants/baas-{slug}/`. Backups: `/opt/baas-backups/{slug}/`.

## Common checks

```bash
# BaaS containers only
ssh -p 5555 usher-node@143.105.102.121 "docker ps -a --format '{{.Names}}\t{{.Status}}' | grep -Ei 'baas'"

# API / worker logs
ssh -p 5555 usher-node@143.105.102.121 "docker logs --tail 100 baas-api"

# Platform DB connectivity + tenant list
ssh -p 5555 usher-node@143.105.102.121 "docker exec baas-postgres psql -U postgres -c 'select slug,status,host_port_base from baas_projects order by created_at desc;'"

# Port allocations (collision debugging)
ssh -p 5555 usher-node@143.105.102.121 "docker exec baas-postgres psql -U postgres -c 'select port_base,status,project_id from baas_port_allocations order by port_base;'"

# Health
ssh -p 5555 usher-node@143.105.102.121 "curl -fsS http://localhost:4001/health"

# Disk / resource pressure
ssh -p 5555 usher-node@143.105.102.121 "df -h / | tail -1; docker stats --no-stream --format '{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}' | grep -i baas"
```

## Guardrails

- These are diagnostics. To change state (restart, redeploy) use the `deploy` skill or an
  explicit, confirmed action.
- If a tenant container is unhealthy, check `docker logs baas-{slug}-db` first — most
  provisioning failures are DB healthcheck timeouts.
