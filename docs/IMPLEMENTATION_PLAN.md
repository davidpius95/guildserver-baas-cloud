# GuildServer BaaS Cloud — Complete Implementation & Deployment Plan (v2, merged)

> **Purpose:** A standalone repository that turns self-hosted Supabase into a full Supabase Cloud equivalent, with multi-tenant provisioning, organizations, branching, auto-scaling, backups, logs, and a management API — **plus** a push-to-GitHub → auto-deploy-to-server pipeline.

> **Target:** Execute in `github.com/davidpius95/guildserver-baas-cloud`; all testing/setup runs on the server `ssh -p 5555 usher-node@143.105.102.121`.

---

## v2 Revisions (what changed from the original plan, and why)

This document merges the original complete plan with the architecture decisions made in review. Every original section is preserved; revisions are marked inline with **`[REVISED v2]`** callouts. Summary:

1. **Single-node v1** — no fleet/SSH provisioning. `baas_nodes` is one seeded `localhost` row; `sshUser/sshPort/sshPrivateKey` dropped from schema (re-added when real multi-node is built). Provisioning uses local `docker compose`.
2. **Secrets encrypted at rest** — AES-256-GCM via new `crypto.ts`; master key `BAAS_ENCRYPTION_KEY`; API fails fast on boot if missing/malformed.
3. **PITR deferred** — v1 ships pg_dump backups only. `pitr-orchestrator.ts` is NOT built now (columns reserved). True PITR needs `pg_basebackup` + WAL archiving + retention policy — a dedicated future phase.
4. **Auto-scaling = live resize + conditional restart** — `docker update` always; rewrite `postgresql.conf` + restart `db` only when RAM change > 15%; 20-min cooldown via `lastScaledAt`. (Original silently assumed live RAM changes take effect; `shared_buffers` needs a restart.)
5. **Port-collision system** — new `port-manager.ts`: DB reservation under a Postgres advisory lock + real OS socket-bind verification + a reconciliation cron. Replaces the naive "max + 10" allocator (race-prone; blind to non-tracked ports).
6. **Concurrency/oversubscription** — port allocation + node-capacity check + row insert wrapped in one advisory-locked transaction.
7. **Branch merge safety** — `mergeBranch` takes an automatic `pre_merge` snapshot before the destructive parent replace.
8. **Idle-detector guard** — `WHERE status='active'` so it never queries a stopped tenant's `pg_stat_activity`.
9. **Deployment** — GitHub Actions auto-deploy on push to `main` via a dedicated SSH deploy key. Deploys alongside the existing GuildServer PaaS stack; old BaaS footprint removed first (Phase 0).
10. **Platform Postgres port** — `5434` (the diagram's `:5433` is PaaS Postgres; BaaS platform DB is dedicated on `5434`).

---

## Table of Contents

0. [Phase 0 — Server Cleanup](#phase-0--server-cleanup)
1. [Architecture Overview](#1-architecture-overview)
2. [Repository Setup](#2-repository-setup)
3. [Monorepo Structure](#3-monorepo-structure)
4. [Phase 1 — Foundation](#4-phase-1--foundation)
5. [Phase 2 — Scheduler Package](#5-phase-2--scheduler-package)
6. [Phase 3 — Database Package](#6-phase-3--database-package)
7. [Phase 4 — API Server](#7-phase-4--api-server)
8. [Phase 5 — Platform Docker Compose](#8-phase-5--platform-docker-compose)
9. [Phase 6 — Logs & Analytics](#9-phase-6--logs--analytics)
10. [Phase 7 — Database Branching](#10-phase-7--database-branching)
11. [Phase 8 — PITR (DEFERRED)](#11-phase-8--pitr-deferred)
12. [Phase 9 — Auto-Scaling](#12-phase-9--auto-scaling)
13. [Phase 10 — REST API (OpenAPI)](#13-phase-10--rest-api-openapi)
14. [Phase 11 — Web Dashboard](#14-phase-11--web-dashboard)
15. [Deployment Pipeline (push-to-server)](#15-deployment-pipeline)
16. [Skills to Create](#16-skills-to-create)
17. [Environment Variables Reference](#17-environment-variables-reference)
18. [Verification Checklist](#18-verification-checklist)
19. [Execution Order](#19-execution-order)

---

## Phase 0 — Server Cleanup

> **`[REVISED v2 — NEW]`** The server is a live box running the GuildServer PaaS + monitoring stack. Remove ONLY the old BaaS footprint; keep everything else.

**Verified server state:** Ubuntu 24, Docker 27.5, Compose v2.32, node 20, pnpm 10. `guildserver` + `guildserver-network` docker networks exist. PaaS Postgres on host `5433`, Redis on `6380`. A real Cloudflare token exists in the old `.env`.

**Remove (BaaS only):**
- Containers: `guildserver-baas-api`, `guildserver-baas-web`, `baas-postgres`, `baas-imgproxy`, and any tenant leftovers `baas-test-69kcp-*` / `baas-*` / `guildserver-baas-*`. Confirm live: `docker ps -a --format '{{.Names}}' | grep -Ei 'baas'`.
- Volume: `baas-platform_baas-postgres-data`.
- Dirs/files: `~/guildserver-baas` (old non-git project), `~/rollback-baas-20260624-145237.tgz`, any `/opt/baas-*` tenant/backup dirs (check first).
- Stray `~/guildserver-baas-cloud` (separate git init on `master`, no remote) → remove and re-clone from GitHub in Phase 15.

**KEEP (do not touch):** `gs-po-*` (Portainer), `hermes-*`, all `guildserver-*` (paas-web/api, traefik, grafana, prometheus, loki, promtail, exporters, cadvisor, postgres:5432, redis, docs), all exited `gs-*` PaaS apps, both docker networks.

---

## 1. Architecture Overview

```mermaid
graph TB
    subgraph "GuildServer BaaS Cloud (This Repo)"
        subgraph "Platform Layer"
            API["API Server<br/>Express + tRPC<br/>:4001"]
            WEB["Dashboard<br/>Next.js<br/>:3001"]
            WORKER["BullMQ Workers<br/>(provision/backup)"]
            CRON["Cron Jobs<br/>(idle/metrics/sweep/port-reconcile)"]
        end
        subgraph "Shared Infrastructure"
            PG_PLATFORM["Platform Postgres<br/>(schema: baas_*)<br/>:5434"]
            REDIS["Redis<br/>(BullMQ queues)<br/>:6379"]
        end
        subgraph "Per-Tenant Stacks (N instances)"
            subgraph "Tenant 'acme'"
                T1_DB["Postgres 17"]
                T1_KONG["Kong Gateway"]
                T1_AUTH["GoTrue Auth"]
                T1_REST["PostgREST"]
                T1_RT["Realtime"]
                T1_STORE["Storage API"]
                T1_FN["Edge Functions"]
                T1_STUDIO["Studio"]
                T1_LOG["Logflare Analytics"]
                T1_VEC["Vector Log Collector"]
            end
        end
    end
    CLIENT["Client Apps / SDKs"] --> T1_KONG
    ADMIN["Platform Admin"] --> WEB
    WEB --> API
    API --> PG_PLATFORM
    API --> REDIS
    WORKER --> REDIS
    WORKER -->|"Docker API / local compose"| T1_DB
    CRON --> PG_PLATFORM
```

### How It Works
1. **Platform admin** creates an organization + project via the dashboard or API.
2. **API** inserts a project record into `baas_projects`, enqueues a `provision` job in BullMQ.
3. **Worker** picks up the job, generates + **encrypts** secrets, **reserves a port window (advisory-locked + OS-verified)**, writes a `docker-compose.yml` from a template, runs `docker compose up -d`.
4. **Cron jobs** monitor health, collect metrics, detect idle projects, reconcile port allocations, run backups.
5. **Each tenant** gets isolated Postgres, Auth, REST, Realtime, Storage, Edge Functions, Studio, Analytics.

> **`[REVISED v2]`** Single-node: the API host IS the compute node; provisioning is local `docker compose`, no SSH. Platform Postgres is dedicated on `:5434` (distinct from PaaS Postgres `:5433`).

---

## 2. Repository Setup

Already done: repo exists at `github.com/davidpius95/guildserver-baas-cloud` (`main`), with root `package.json`, `pnpm-workspace.yaml`, `turbo.json`, and `vendor/supabase` submodule.

> [!IMPORTANT]
> We do NOT fork Supabase — it's a **vendor submodule** (image/version reference only, never imported). Platform code lives above it; `git submodule update` pulls image bumps with no merge conflicts.

---

## 3. Monorepo Structure

```
guildserver-baas-cloud/
├── .github/workflows/deploy.yml     # [v2 NEW] auto-deploy on push to main
├── .claude/skills/                  # [v2 NEW] deploy + server-ops skills
├── vendor/supabase/                 # Git submodule
├── apps/
│   ├── api/  (Express + tRPC API — src/index.ts, trpc/, routers/, routes/)
│   └── web/  (Next.js dashboard — src/app/...)
├── packages/
│   ├── database/  (Drizzle schema + migrations)
│   └── scheduler/
│       └── src/
│           ├── index.ts             # Barrel export
│           ├── crypto.ts            # [v2 NEW] AES-256-GCM encrypt/decrypt
│           ├── port-manager.ts      # [v2 NEW] reserve/verify/reconcile ports
│           ├── secrets.ts
│           ├── tenant-db.ts
│           ├── compose-template.ts
│           ├── project-lifecycle.ts
│           ├── backup-orchestrator.ts
│           ├── branch-manager.ts
│           ├── auto-scaler.ts
│           ├── health-reconciler.ts
│           ├── idle-detector.ts
│           ├── metrics-collector.ts
│           └── node-selector.ts
│           # NOTE: pitr-orchestrator.ts DEFERRED — not built in v1
├── docker-compose.yml               # Platform services (baas-postgres, redis, imgproxy)
├── .env.example
├── package.json / pnpm-workspace.yaml / turbo.json / tsconfig.base.json
└── README.md
```

---

## 4. Phase 1 — Foundation

### 4.1 Root `package.json`
```json
{
  "name": "guildserver-baas-cloud",
  "version": "1.0.0",
  "private": true,
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "dev": "turbo run dev", "build": "turbo run build", "start": "turbo run start",
    "typecheck": "turbo run typecheck", "db:generate": "turbo run db:generate", "db:migrate": "turbo run db:migrate"
  },
  "devDependencies": { "turbo": "^2.5.0", "typescript": "^5.7.0", "prettier": "^3.4.0" },
  "engines": { "node": ">=20", "pnpm": ">=9" },
  "packageManager": "pnpm@9.15.0"
}
```

### 4.2 `pnpm-workspace.yaml`
```yaml
packages:
  - "apps/*"
  - "packages/*"
```

### 4.3 `turbo.json`
```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "dev": { "cache": false, "persistent": true },
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**", ".next/**"] },
    "start": { "dependsOn": ["build"] },
    "typecheck": { "dependsOn": ["^build"] },
    "db:generate": {}, "db:migrate": {}
  }
}
```

### 4.4 `tsconfig.base.json`
```json
{
  "compilerOptions": {
    "target": "ES2022", "module": "Node16", "moduleResolution": "Node16", "lib": ["ES2022"],
    "strict": true, "esModuleInterop": true, "skipLibCheck": true, "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true, "declaration": true, "declarationMap": true, "sourceMap": true, "outDir": "dist"
  }
}
```

### 4.5 `.env.example` — see [§17](#17-environment-variables-reference). **`[REVISED v2]`** adds `BAAS_ENCRYPTION_KEY`, `BAAS_TENANT_PORT_RANGE_START/END`.

---

## 5. Phase 2 — Scheduler Package

### `packages/scheduler/package.json`
```json
{
  "name": "@guildserver/baas-scheduler", "version": "1.0.0", "private": true, "main": "src/index.ts",
  "scripts": { "build": "tsc", "typecheck": "tsc --noEmit" },
  "dependencies": { "@guildserver/baas-db": "workspace:*", "dockerode": "^4.0.4", "jose": "^6.0.11", "postgres": "^3.4.7" },
  "devDependencies": { "@types/dockerode": "^3.3.35", "typescript": "^5.7.0" }
}
```

### 5.1 `src/index.ts` — Barrel Export
```typescript
export { encryptSecret, decryptSecret } from "./crypto";                       // [v2 NEW]
export { allocatePortBase, confirmPortBinding, releasePortAllocation, reconcilePortAllocations } from "./port-manager"; // [v2 NEW]
export { generateProjectSecrets } from "./secrets";
export { createTenantDatabase, dropTenantDatabase } from "./tenant-db";
export { generateComposeYml, generateKongConfig, generatePostgresqlConf } from "./compose-template";
export { provisionProject, pauseProject, resumeProject, deleteProject, wakeProject } from "./project-lifecycle";
export { createBackup, restoreBackup, sweepExpiredBackups } from "./backup-orchestrator";
export { createBranch, deleteBranch, mergeBranch } from "./branch-manager";
export { evaluateScaling } from "./auto-scaler";
export { reconcileNodes, reconcileProjects } from "./health-reconciler";
export { detectIdleProjects } from "./idle-detector";
export { collectAllMetrics, collectProjectMetrics, pruneOldMetrics } from "./metrics-collector";
export { selectNode, incrementNodeUsage, decrementNodeUsage } from "./node-selector";
// DEFERRED: pitr-orchestrator (setupPitr/restorePitr) — not exported in v1
```

### 5.1a `src/crypto.ts` — **`[REVISED v2 — NEW]`**
AES-256-GCM. Key from `BAAS_ENCRYPTION_KEY` (base64, 32 bytes). Payload = base64(iv[12] ‖ authTag[16] ‖ ciphertext).
```typescript
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
const KEY = Buffer.from(process.env.BAAS_ENCRYPTION_KEY!, "base64");
export function encryptSecret(pt: string): string {
  const iv = randomBytes(12); const c = createCipheriv("aes-256-gcm", KEY, iv);
  const enc = Buffer.concat([c.update(pt, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString("base64");
}
export function decryptSecret(payload: string): string {
  const b = Buffer.from(payload, "base64");
  const d = createDecipheriv("aes-256-gcm", KEY, b.subarray(0,12)); d.setAuthTag(b.subarray(12,28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8");
}
```

### 5.1b `src/port-manager.ts` — **`[REVISED v2 — NEW]`**
- `allocatePortBase(nodeId, tx)`: `SELECT pg_advisory_xact_lock(hashtext(nodeId))` → compute next candidate window from `baas_port_allocations` (max bound/reserved portBase + 10, else range start) → skip platform-excluded ports (4001/3001/5434/6379/8080) and windows exceeding `BAAS_TENANT_PORT_RANGE_END` → **verify all 10 ports free via real `net.createServer().listen()`** → insert `reserved` row → return portBase. Retry ≤ 20 candidate windows, else throw.
- `confirmPortBinding(portBase)`: flip `reserved → bound` after DB healthcheck passes.
- `releasePortAllocation(projectId)`: flip → `released` on delete (keep row for audit).
- `reconcilePortAllocations()`: `bound` but OS-free → flag project `error`; `released`/untracked but OS-occupied → log loudly, never auto-allocate over; `reserved` > 10 min with no active project → auto-release.
```typescript
function canBind(port: number): Promise<boolean> {
  return new Promise((res) => { const s = net.createServer();
    s.once("error", () => res(false)); s.once("listening", () => s.close(() => res(true)));
    s.listen(port, "0.0.0.0"); });
}
```

### 5.2 `src/secrets.ts`
`jose`-signed JWTs; `generateProjectSecrets() → { jwtSecret(40 hex), dbPassword(16 hex), anonKey, serviceRoleKey }`. `anonKey`/`serviceRoleKey` signed `{ role, iss:"supabase" }` exp 2099. **`[REVISED v2]`** Caller (`project-lifecycle`) encrypts outputs via `crypto.ts` before persisting — generation stays separate from encryption.

### 5.3 `src/tenant-db.ts`
`createTenantDatabase(dbName,dbUser,dbPassword)`: connect as admin → `CREATE DATABASE` → `CREATE USER … PASSWORD` → `GRANT ALL … TO user` → in new DB grant default privileges to `anon/authenticated/service_role` on `public`. `dropTenantDatabase(dbName,dbUser)`: `pg_terminate_backend` → `DROP DATABASE IF EXISTS` → `DROP USER IF EXISTS`.

### 5.4 `src/compose-template.ts`
`ProjectComposeConfig`: `{ projectSlug, dbName, dbUser, dbPassword, jwtSecret, anonKey, serviceRoleKey, apiExternalUrl, siteUrl, hostPortBase, ramMbLimit, vcpuLimit, smtp?, walArchiveEnabled?, analyticsEnabled? }`.

**11 core services:** `db` supabase/postgres:17.6.1.136 · `supavisor` 2.9.5 · `kong` 3.9.1 · `auth` gotrue:v2.189.0 · `rest` postgrest:v14.12 · `realtime` v2.102.3 · `storage` v1.60.4 · `imgproxy` v3.30.1 · `meta` v0.96.6 · `functions` edge-runtime:v1.74.0 · `studio` 2026.06.03-sha-0bca601.
**Conditional (analyticsEnabled):** `analytics` logflare:1.12.0 · `vector` timberio/vector:0.34-alpine (Phase 6/9 below).
Also: `generateKongConfig({anonKey,serviceRoleKey})` (declarative routes for auth/rest/realtime/storage/meta/functions); `generatePostgresqlConf(ramMb, walArchiveEnabled)` (shared_buffers 25%, effective_cache_size 75%, …). Resource split: DB 25%/40%, Auth 25%/20%, REST 25%/15%, rest share remainder.
> **`[REVISED v2]`** `walArchiveEnabled` accepted but unused in v1 (PITR deferred).

### 5.5 `src/project-lifecycle.ts`
**`provisionProject(input)`** — **`[REVISED v2]`**:
1. `generateProjectSecrets()` → `encryptSecret()` each.
2. **One advisory-locked transaction:** `selectNode()` → capacity check (`ramMbUsed + req ≤ ramMbTotal`) → `allocatePortBase(nodeId, tx)` → `incrementNodeUsage()` → insert `baas_projects` row (status `provisioning`, encrypted secrets, portBase). Commit.
3. `createTenantDatabase()`.
4. Generate `docker-compose.yml` + `kong.yml` + `postgresql.conf` → write to `$TENANT_DATA_DIR/baas-{slug}/`.
5. `docker compose -f … up -d` (execFile).
6. Poll `pg_isready` ≤ 60s.
7. `confirmPortBinding(portBase)`; set endpoints + status `active`.

`pauseProject` (compose stop, status `paused`) · `resumeProject` (compose start, status `active`, touch `lastActivityAt`) · `deleteProject` (compose `down -v` → `dropTenantDatabase` → `decrementNodeUsage` → **`releasePortAllocation`** → delete row → clean data dir) · `wakeProject` (resume if paused).

### 5.6 `src/backup-orchestrator.ts`
`createBackup(projectId,type)`: `docker exec baas-{slug}-db pg_dump -U postgres -Fc` → `$BACKUP_DIR/{slug}/{ts}.dump`; record in `baas_backups`. `restoreBackup(backupId)`: stop stack → terminate conns/drop/create DB → `docker cp` + `pg_restore` → start. `sweepExpiredBackups()`: delete files + rows where `expiresAt < now()`. **`[REVISED v2]`** Only backup mechanism in v1 (no PITR).

### 5.7 `src/health-reconciler.ts`
`reconcileProjects()`: inspect each active project's containers; any down → status `error` listing missing. `reconcileNodes()`: **`[REVISED v2]`** single-node — verify local Docker + platform Postgres reachable.

### 5.8 `src/idle-detector.ts`
`detectIdleProjects()`: select active projects **`WHERE status='active' AND idleTimeoutMinutes IS NOT NULL`** `[REVISED v2 guard]` → query tenant `pg_stat_activity`; conns > 0 → touch `lastActivityAt`; conns = 0 AND idle past timeout → `pauseProject()`.

### 5.9 `src/metrics-collector.ts`
`collectProjectMetrics`: docker stats CPU%/mem + tenant `pg_stat_database` (conns, size, tx committed/rolled back) → insert `baas_metrics`. `collectAllMetrics` (parallel) · `pruneOldMetrics` (> 30 days).

### 5.10 `src/node-selector.ts` — **`[REVISED v2]`**
`selectNode()`: single-row `WHERE role='compute' AND status='online' LIMIT 1` (no scoring). `incrementNodeUsage`/`decrementNodeUsage`: atomic `ram_mb_used + $delta`, called inside the port-allocation transaction. (Port logic moved to `port-manager.ts`.)

### 5.11 `src/branch-manager.ts`
`createBranch(parentId,name)`: dump parent → new slug `{parent}-branch-{hash}` → `provisionProject()` → restore dump → insert row with `parentProjectId`/`branchName`. `deleteBranch(id)`: verify branch → `deleteProject()`. **`mergeBranch(id)` `[REVISED v2]`:** load branch+parent → **`createBackup(parent.id, "pre_merge")`** (safety snapshot) → dump branch → stop parent → restore into parent (full replace) → restart → delete branch.
> [!WARNING] Merge replaces the parent DB. The `pre_merge` snapshot makes it a `restoreBackup()` away from recoverable.

### 5.12 `src/auto-scaler.ts` — **`[REVISED v2]`**
`evaluateScaling(projectId)`:
1. Rolling avg of last 10 metrics (CPU%, RAM).
2. Up if avg CPU > 80% or RAM > 85% (3+ windows) → 1.5× capped at node capacity; Down if CPU < 20% and RAM < 30% (10+ windows) → 0.75× floored at min tier.
3. **Always** live `docker update` (CpuQuota + Memory) on db/rest/auth.
4. **If RAM change > 15%** → `rewritePostgresConf()` + `docker compose restart db` (brief downtime).
5. Cooldown ≥ 20 min via `lastScaledAt`. Log to `baas_scaling_events` with `restarted` boolean.

### 5.13 ~~`src/pitr-orchestrator.ts`~~ — **`[REVISED v2 — DEFERRED]`**
Not built in v1. Future phase requires `pg_basebackup` scheduling + continuous WAL archiving + a WAL retention/pruning policy (undefined in the original plan and must be designed before building). Schema columns `walArchiveEnabled`/`walArchivePath`/`pitrEnabled` are reserved.

---

## 6. Phase 3 — Database Package

### `packages/database/package.json`
```json
{
  "name": "@guildserver/baas-db", "version": "1.0.0", "private": true, "main": "src/index.ts",
  "scripts": { "db:generate": "drizzle-kit generate", "db:migrate": "tsx src/migrate.ts", "typecheck": "tsc --noEmit" },
  "dependencies": { "drizzle-orm": "^0.39.3", "postgres": "^3.4.7" },
  "devDependencies": { "drizzle-kit": "^0.30.5", "tsx": "^4.19.4", "typescript": "^5.7.0" }
}
```

### 6.1 `src/schema/index.ts`

**Enums:** `baasProjectStatus`(provisioning|active|paused|error|deleting) · `baasNodeRole`(edge|compute|storage) · `baasNodeStatus`(online|offline|maintenance|error) · `backupStatus`(pending|in_progress|completed|failed) · `domainStatus`(pending|verifying|active|failed|expired) · **`[v2]`** `portAllocStatus`(reserved|bound|released).

**Tables:**
- **`users`**: id(uuid PK), email(uniq), name, password(bcrypt), role(default "user").
- **`organizations`**: id, name, slug(uniq), ownerId→users, product(default "baas"), timestamps.
- **`members`**: id, userId→users, organizationId→orgs, role(owner|admin|member).
- **`baas_nodes`**: id, name, hostname, internalIp(inet), externalIp(inet null), role, status, `vcpuTotal/ramMbTotal/storageGbTotal`, `vcpuUsed/ramMbUsed/storageGbUsed`(default 0), providerId, location, lastHeartbeat, metadata(jsonb), timestamps. Idx: status, role. **`[REVISED v2]` dropped `sshUser/sshPort/sshPrivateKey`.** Seed one `localhost` compute row.
- **`baas_projects`**: id, name, slug(uniq), organizationId→orgs, nodeId→nodes; secrets `dbPassword/jwtSecret/anonKey/serviceRoleKey`(text, **encrypted** `[v2]`); db `dbHost/dbPort/dbName/dbUser`; endpoints `apiUrl/realtimeUrl/storageUrl/studioUrl`; `hostPortBase`(int); limits `vcpuLimit`(dec)/`ramMbLimit`(int)/`storageGbLimit`(int); `status`+`statusMessage`; `containerIds`(jsonb); backup `backupEnabled`(bool)/`backupRetentionDays`; auto-pause `idleTimeoutMinutes`(null)/`lastActivityAt`/`autoWakeEnabled`; WAL/PITR `walArchiveEnabled`/`walArchivePath`/`pitrEnabled` (reserved); branching `parentProjectId`(uuid null self)/`branchName`/`branchType`(preview|staging); scaling `scalingMode`(manual|auto)/`minVcpu/maxVcpu/minRamMb/maxRamMb`; **`[v2]` `lastScaledAt`(ts null)**; analytics `analyticsEnabled`(bool default false); timestamps. Idx: organizationId, nodeId, status, parentProjectId.
- **`baas_backups`**: id, projectId→projects, status, `backupType`(manual|automatic|**pre_merge** `[v2]`|~~base~~reserved), `sizeBytes`, `filePath`, `walTargetTime`(null), `error`, startedAt/completedAt/expiresAt/createdAt. Idx: projectId, status.
- **`baas_custom_hostnames`**: id, projectId→projects, hostname(uniq), `cfCustomHostnameId/cfOwnershipTxtName/cfOwnershipTxtValue/cfSslStatus`, status, verified(bool), timestamps. Idx: projectId.
- **`baas_metrics`**: id, projectId→projects, collectedAt, `cpuPercent`(dec)/`ramMbUsed`(int)/`storageGbUsed`(dec), `activeConnections`/`dbSizeMb`/`txCommitted`/`txRolledBack`, metadata(jsonb). Idx: projectId, collectedAt, (projectId,collectedAt).
- **`baas_scaling_events`**: id, projectId→projects, `direction`(up|down), `prevVcpu/newVcpu/prevRamMb/newRamMb`, **`restarted`(bool) `[v2]`**, reason(text), createdAt.
- **`baas_port_allocations`** **`[v2 NEW]`**: id, nodeId→nodes, `portBase`(int), projectId→projects, `status`(reserved|bound|released), reservedAt, boundAt(null), releasedAt(null). Unique(nodeId, portBase). Idx: nodeId, status.

**Relations:** nodes→many projects; projects→one node/org, many backups/hostnames/metrics/scalingEvents/portAllocations, one self(parent); child tables→one project.

### 6.2 `src/index.ts`
```typescript
import { drizzle } from "drizzle-orm/postgres-js"; import postgres from "postgres"; import * as schema from "./schema";
const sql = postgres(process.env.DATABASE_URL!);
export const db = drizzle(sql, { schema }); export * from "./schema";
```

---

## 7. Phase 4 — API Server

### `apps/api/package.json`
deps: `@guildserver/baas-db`, `@guildserver/baas-scheduler`, `@trpc/server ^11.3.0`, `bcryptjs`, `bullmq ^5.51.0`, `cors`, `dotenv`, `express ^4.21`, `jose`, `node-cron ^4`, `zod ^3.24`. scripts: dev(`tsx watch`), build(`tsc`), start(`node dist/index.js`).

### 7.1 `src/index.ts` — Entrypoint
1. Express + CORS + JSON.
2. tRPC at `/trpc`.
3. REST: `/health`, `/traefik/config`, `/studio/:projectId/config`.
4. **`[REVISED v2]` Boot validation:** reject startup if `BAAS_ENCRYPTION_KEY` missing or not 32 bytes decoded.
5. **Workers:** `baas-provision`(conc 3): provision/pause/resume/delete/branch-create/branch-delete/branch-merge. `baas-backup`(conc 2): create/restore.
6. **Crons:** 30s `reconcileNodes`+`reconcileProjects`+**`reconcilePortAllocations`** `[v2]`; 5m `detectIdleProjects`; 2m `collectAllMetrics`; 10m `evaluateScaling` (auto projects); 03:00 auto-backup; 04:00 `sweepExpiredBackups`; 04:30 `pruneOldMetrics`.

### 7.2 Routers
| Router | Procedures |
|---|---|
| `auth` | register, login, me |
| `organization` | list, create, get, update, delete, inviteMember, removeMember, listMembers |
| `project` | list, create, get, update, pause, resume, wake, delete, connectionInfo |
| `backup` | list, createManual, restore |
| `domain` | list, add, checkVerification, remove |
| `node` | list, get, register, update, deregister |
| `metrics` | latest, range |
| `branch` | list, create, merge, delete |
> **`[REVISED v2]`** any secret-returning procedure (`project.connectionInfo`, `studio-config`) calls `decryptSecret()` before responding. `restorePitr` removed from `backup` (PITR deferred).

### 7.3 Context (`trpc/context.ts`)
Bearer token → `jose.jwtVerify(JWT_SECRET)` → look up user + org membership → `{ userId, organizationId, isAuthenticated, isAdmin }`.

### 7.4 Base (`trpc/trpc.ts`)
`publicProcedure` / `protectedProcedure`(auth) / `adminProcedure`(auth+admin).

---

## 8. Phase 5 — Platform Docker Compose

`docker-compose.yml` (`name: baas-platform`, network `guildserver`):
- **`baas-postgres`** supabase/postgres:17.6.1.136, `5434:5432`, `shm_size 256mb`, `POSTGRES_PASSWORD=${BAAS_PG_ADMIN_PASSWORD}`, volume `baas-postgres-data`, healthcheck `pg_isready`.
- **`redis`** redis:7-alpine, `6379:6379`, volume `baas-redis-data`.
- **`baas-imgproxy`** darthsim/imgproxy:v3.30.1 (`IMGPROXY_BIND :8080`, webp detection, etag).

Ports 4001/3001/5434/6379/8080 are in the port-manager exclusion set.

---

## 9. Phase 6 — Logs & Analytics

When `analyticsEnabled: true`, `compose-template.ts` appends:
- **`analytics`** supabase/logflare:1.12.0 (`LOGFLARE_SINGLE_TENANT/SUPABASE_MODE=true`, `LOGFLARE_API_KEY=${serviceRoleKey}`, `POSTGRES_BACKEND_URL=…@db:5432/postgres`, `POSTGRES_BACKEND_SCHEMA=_analytics`, depends_on db healthy).
- **`vector`** timberio/vector:0.34-alpine (mounts `vector.yml` + docker.sock ro).
Generate `vector.yml` (filtered to this stack's containers → logflare). Flip Studio `NEXT_PUBLIC_ENABLE_LOGS=true`, `LOGFLARE_URL=http://analytics:4000`.

---

## 10. Phase 7 — Database Branching

Router `branch.ts`: `list`(projects where parentProjectId=projectId), `create`(enqueue branch-create), `merge`(enqueue branch-merge), `delete`(enqueue branch-delete). Worker dispatch in `index.ts` maps job names → `createBranch/deleteBranch/mergeBranch`. Schema branching fields already in `baas_projects` (§6.1). Merge takes the `pre_merge` snapshot (§5.11).

---

## 11. Phase 8 — PITR (DEFERRED)

> **`[REVISED v2]`** NOT built in v1. Schema fields reserved. When built: `pg_basebackup` scheduling + `archive_command` WAL shipping + `recovery_target_time` replay + WAL retention/pruning policy + `backupType:"base"`. `pg_dump` (v1's mechanism) cannot do timestamp recovery — different mechanism entirely.

---

## 12. Phase 9 — Auto-Scaling

Implemented per §5.12 (live `docker update` + conditional conf-rewrite/restart + 20-min cooldown, logged to `baas_scaling_events.restarted`). 10-min cron evaluates `scalingMode='auto'` projects.

---

## 13. Phase 10 — REST API (OpenAPI)

Stretch/optional. `pnpm add trpc-openapi --filter @guildserver/baas-api`; add `.meta()` per procedure; mount `createOpenApiExpressMiddleware` at `/api/v1` + serve `/api/v1/openapi.json`. Yields a Supabase-style Management API.

---

## 14. Phase 11 — Web Dashboard

Next.js 15 (App Router), Tailwind, tRPC React client, Recharts, Studio iframe embedding.

| Page | Route |
|---|---|
| Login/Register | `/login`, `/register` |
| Projects | `/dashboard` |
| Overview | `/dashboard/project/[id]` |
| Editor/Auth/Storage/Logs | `/dashboard/project/[id]/{editor,auth,storage,logs}` (Studio iframes) |
| Functions | `/dashboard/project/[id]/functions` |
| Settings | `.../settings` (pause/resume, scaling mode, idle timeout, backup config) |
| Backups | `.../backups` |
| Domains | `.../domains` |
| Metrics | `.../metrics` (charts) |
| Branches | `.../branches` |

Sidebar: org switcher, project list, create button. Studio pages fetch `/studio/:projectId/config` (decrypted keys) then iframe the tenant `apiUrl`.

---

## 15. Deployment Pipeline

> **`[REVISED v2 — NEW]`** Push to `main` → server auto-updates.

**SSH deploy key:** generate ed25519 keypair; append pubkey to server `~/.ssh/authorized_keys`; private key + host/port/user stored as GitHub Actions secrets (`SERVER_SSH_KEY`, `SERVER_HOST`, `SERVER_PORT`, `SERVER_USER`). Password `usher` used once for bootstrap only.

**Server clone:** clean clone into `~/guildserver-baas-cloud` with `--recurse-submodules`; create `.env` from `.env.example` with real secrets — generate `BAAS_ENCRYPTION_KEY` via `openssl rand -base64 32`, reuse PaaS `DATABASE_URL`/Cloudflare token from the old `.env` where appropriate. `.env` is server-side only, never committed.

**`.github/workflows/deploy.yml`:** on push to `main` → `appleboy/ssh-action` (or raw ssh) → `cd ~/guildserver-baas-cloud && git pull --recurse-submodules && pnpm install --frozen-lockfile && pnpm db:migrate && docker compose up -d --build` → curl `/health`.

**Session limitation:** setting GitHub secrets needs `gh auth login` (interactive OAuth, impossible in this non-interactive session) or the GitHub web UI. Plan: I generate the keypair + provide exact `gh secret set …` commands / web-UI values; you run `gh auth login` once (or paste into the UI), then I finish wiring.

---

## 16. Skills to Create

> Per request — create project skills so recurring server work isn't re-derived each session.

- **`.claude/skills/deploy/`** — SSH in, `git pull`, install, migrate, rebuild BaaS containers, health-check, report. Mirrors the GH-Action logic so `/deploy` works locally too.
- **`.claude/skills/server-ops/`** — read-only diagnostics: `docker ps` (baas), tail api/worker logs, list tenants, platform-DB connection check.

---

## 17. Environment Variables Reference

```env
# ── Platform Database ──
DATABASE_URL=postgres://postgres:${BAAS_PG_ADMIN_PASSWORD}@localhost:5434/postgres
BAAS_PG_ADMIN_PASSWORD=strong-admin-password

# ── Secrets encryption [v2 NEW] ──
BAAS_ENCRYPTION_KEY=            # 32-byte base64 (openssl rand -base64 32) — API fails fast if unset/wrong length

# ── Auth ──
JWT_SECRET=change-me-min-32-chars
JWT_EXPIRES_IN=7d

# ── API ──
BAAS_API_PORT=4001
BAAS_WEB_URL=http://localhost:3001
BAAS_BASE_DOMAIN=baas.localhost
BAAS_FALLBACK_DOMAIN=baas.guildserver.com
BAAS_TLS=false
BAAS_CERT_RESOLVER=letsencrypt

# ── Tenant data & ports ──
TENANT_DATA_DIR=/opt/baas-tenants
BAAS_BACKUP_DIR=/opt/baas-backups
BAAS_TENANT_PORT_RANGE_START=9000   # [v2 NEW]
BAAS_TENANT_PORT_RANGE_END=65000    # [v2 NEW]

# ── Redis ──
REDIS_HOST=localhost
REDIS_PORT=6379

# ── Cloudflare (custom domains) ──
CF_ZONE_ID=
CF_API_TOKEN=

# ── SMTP (→ GoTrue per tenant) ──
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=

# ── Docker ──
BAAS_DOCKER_NETWORK=guildserver

# ── Frontend ──
NEXT_PUBLIC_BAAS_API_URL=http://localhost:4001
NEXT_PUBLIC_PAAS_WEB_URL=http://localhost:3000
```

---

## 18. Verification Checklist

**Phase 0 — Cleanup:** only BaaS containers/volume/dirs removed; PaaS + monitoring + Portainer + hermes untouched.
**Phase 1 — Foundation:** `pnpm install` ok; `turbo typecheck` passes; `pnpm db:migrate` creates all tables incl. `baas_port_allocations`.
**Phase 2–4 — Core:** API boots (rejects missing/bad `BAAS_ENCRYPTION_KEY`); register→login→org→project.create enqueues job; worker provisions 11 healthy containers; **two concurrent creates never collide on ports**; tenant `/rest/v1/` + `/auth/v1/settings` respond; pause/resume/delete work (delete releases port + drops DB).
**Phase 5 — Backups:** createManual → dump file; restore round-trips; nightly cron backs up; sweep removes expired.
**Phase 6 — Analytics:** analyticsEnabled adds logflare+vector; Studio logs tab on.
**Phase 7 — Branching:** create (separate DB w/ parent data); merge (pre_merge snapshot then replace); delete.
**Phase 9 — Scaling:** auto project evaluated 10m; >80% CPU scales up; >15% RAM change → conf rewrite + restart logged `restarted:true`; idle-detector skips paused.
**Ports:** reconcile cron flags a port occupied outside DB tracking (simulate `nc -l` in a window).
**Deploy:** push to main → server pulls, migrates, rebuilds, `/health` green.
**Phase 11 — Dashboard:** login, project list/create, Studio iframe, metrics charts, backups, branches functional.

---

## 19. Execution Order

1. **Phase 0** — server cleanup (confirm delete list live, remove old BaaS footprint).
2. **Phase 1** — foundation on local → commit + push (also writes this doc to `docs/IMPLEMENTATION_PLAN.md`).
3. **Deploy bootstrap** — generate deploy key, add to server, server clone + `.env`, `.github/workflows/deploy.yml`, skills → commit + push (finish GH secrets after `gh auth login`).
4. **Phase 2 (database)** → migrate on server.
5. **Phase 3 (scheduler)** — crypto → port-manager → node-selector → secrets → tenant-db → compose-template → project-lifecycle → backup → branch → auto-scaler → health → idle → metrics.
6. **Phase 4 (api)** + **Phase 5 (compose)** → deploy.
7. **Phase 6 core-loop verification** on server (register→provision→pause→resume→delete).
8. **Phases 6–9** analytics, branching, auto-scaling.
9. **Phase 11 dashboard**; **Phase 10 OpenAPI** (stretch).
10. Each push auto-deploys and is verified on the server. **PITR remains deferred.**
```
