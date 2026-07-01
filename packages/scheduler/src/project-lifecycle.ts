import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "./config";
import { encryptSecret } from "./crypto";
import { and, baasPortAllocations, baasProjects, db, eq } from "./db";
import { composeCli, dockerExec } from "./docker";
import {
  PORT_OFFSETS,
  generateComposeYml,
  generateKongConfig,
  generatePostgresqlConf,
  generateVectorConfig,
} from "./compose-template";
import { allocatePortBase, confirmPortBinding, releasePortAllocation } from "./port-manager";
import {
  decrementNodeUsage,
  incrementNodeUsage,
  nodeHasCapacity,
  selectNode,
} from "./node-selector";
import { createTenantDatabase, dropTenantDatabase } from "./tenant-db";
import { generateProjectSecrets } from "./secrets";

const DEFAULTS = { ramMb: 1024, vcpu: 1, storageGb: 5 };

function tenantDir(slug: string): string {
  return path.join(config.tenantDataDir, `baas-${slug}`);
}

function composeFile(slug: string): string {
  return path.join(tenantDir(slug), "docker-compose.yml");
}

function scheme(): string {
  return config.tls ? "https" : "http";
}

async function loadProject(projectId: string) {
  const rows = await db.select().from(baasProjects).where(eq(baasProjects.id, projectId)).limit(1);
  const project = rows[0];
  if (!project) throw new Error(`Project ${projectId} not found`);
  return project;
}

async function setStatus(projectId: string, status: "active" | "paused" | "error" | "deleting", message?: string) {
  await db
    .update(baasProjects)
    .set({ status, statusMessage: message ?? null, updatedAt: new Date() })
    .where(eq(baasProjects.id, projectId));
}

/** Poll the tenant DB container until pg_isready passes (or timeout). */
async function waitForDbHealthy(slug: string, dbUser: string, dbName: string, timeoutMs = 60_000) {
  const container = `baas-${slug}-db`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await dockerExec(container, ["pg_isready", "-U", dbUser, "-d", dbName]);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw new Error(`Tenant DB ${container} did not become healthy within ${timeoutMs}ms`);
}

/**
 * Provision a full tenant Supabase stack for an existing (status=provisioning) project row.
 */
export async function provisionProject(projectId: string): Promise<void> {
  const project = await loadProject(projectId);
  const slug = project.slug;
  const ramMb = project.ramMbLimit ?? DEFAULTS.ramMb;
  const vcpu = project.vcpuLimit ? Number(project.vcpuLimit) : DEFAULTS.vcpu;
  const storageGb = project.storageGbLimit ?? DEFAULTS.storageGb;

  try {
    const secrets = await generateProjectSecrets();
    const dbName = `tenant_${slug}`.replace(/-/g, "_");
    const dbUser = `tenant_${slug}`.replace(/-/g, "_");

    // ── One advisory-locked transaction: node capacity + port + usage + row ──
    const { hostPortBase, nodeId } = await db.transaction(async (tx) => {
      const node = await selectNode(tx);
      if (!nodeHasCapacity(node, { ramMb, vcpu, storageGb })) {
        throw new Error(
          `Node ${node.hostname} lacks capacity for ${ramMb}MB/${vcpu}vcpu/${storageGb}GB`,
        );
      }
      const portBase = await allocatePortBase(node.id, tx);
      await tx
        .update(baasPortAllocations)
        .set({ projectId })
        .where(
          and(eq(baasPortAllocations.portBase, portBase), eq(baasPortAllocations.nodeId, node.id)),
        );
      await incrementNodeUsage(node.id, { ramMb, vcpu, storageGb }, tx);

      await tx
        .update(baasProjects)
        .set({
          nodeId: node.id,
          hostPortBase: portBase,
          dbName,
          dbUser,
          dbHost: "db",
          dbPort: 5432,
          dbPassword: encryptSecret(secrets.dbPassword),
          jwtSecret: encryptSecret(secrets.jwtSecret),
          anonKey: encryptSecret(secrets.anonKey),
          serviceRoleKey: encryptSecret(secrets.serviceRoleKey),
          vcpuLimit: String(vcpu),
          ramMbLimit: ramMb,
          storageGbLimit: storageGb,
          updatedAt: new Date(),
        })
        .where(eq(baasProjects.id, projectId));

      return { hostPortBase: portBase, nodeId: node.id };
    });

    // ── Tenant database ──
    await createTenantDatabase(dbName, dbUser, secrets.dbPassword);

    // ── Generate + write compose files ──
    const apiExternalUrl = `${scheme()}://${slug}.${config.baseDomain}`;
    const composeCfg = {
      projectSlug: slug,
      dbName,
      dbUser,
      dbPassword: secrets.dbPassword,
      jwtSecret: secrets.jwtSecret,
      anonKey: secrets.anonKey,
      serviceRoleKey: secrets.serviceRoleKey,
      apiExternalUrl,
      siteUrl: apiExternalUrl,
      hostPortBase,
      ramMbLimit: ramMb,
      vcpuLimit: vcpu,
      walArchiveEnabled: project.walArchiveEnabled,
      analyticsEnabled: project.analyticsEnabled,
    };

    const dir = tenantDir(slug);
    await mkdir(dir, { recursive: true });
    await writeFile(composeFile(slug), generateComposeYml(composeCfg));
    await writeFile(path.join(dir, "kong.yml"), generateKongConfig(secrets));
    await writeFile(
      path.join(dir, "postgresql.conf"),
      generatePostgresqlConf(ramMb, project.walArchiveEnabled),
    );
    if (project.analyticsEnabled) {
      await writeFile(path.join(dir, "vector.yml"), generateVectorConfig(composeCfg));
    }
    if (project.walArchiveEnabled) {
      await mkdir(path.join(dir, "wal-archive"), { recursive: true });
    }

    // ── Bring up the stack ──
    await composeCli(composeFile(slug), ["up", "-d"], { timeoutMs: 300_000 });
    await waitForDbHealthy(slug, dbUser, dbName);
    await confirmPortBinding(hostPortBase);

    // ── Endpoints + active ──
    const kongHttp = hostPortBase + PORT_OFFSETS.kongHttp;
    await db
      .update(baasProjects)
      .set({
        apiUrl: apiExternalUrl,
        realtimeUrl: `${apiExternalUrl}/realtime/v1`,
        storageUrl: `${apiExternalUrl}/storage/v1`,
        studioUrl: `${scheme()}://${slug}.${config.baseDomain}`,
        status: "active",
        statusMessage: `provisioned (kong host port ${kongHttp}, node ${nodeId})`,
        lastActivityAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(baasProjects.id, projectId));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await setStatus(projectId, "error", `provision failed: ${message}`);
    throw err;
  }
}

export async function pauseProject(projectId: string): Promise<void> {
  const project = await loadProject(projectId);
  await composeCli(composeFile(project.slug), ["stop"]);
  await setStatus(projectId, "paused", "paused");
}

export async function resumeProject(projectId: string): Promise<void> {
  const project = await loadProject(projectId);
  await composeCli(composeFile(project.slug), ["start"]);
  await db
    .update(baasProjects)
    .set({ status: "active", statusMessage: "resumed", lastActivityAt: new Date(), updatedAt: new Date() })
    .where(eq(baasProjects.id, projectId));
}

export async function wakeProject(projectId: string): Promise<void> {
  const project = await loadProject(projectId);
  if (project.status === "active") return;
  if (project.status === "paused") await resumeProject(projectId);
}

export async function deleteProject(projectId: string): Promise<void> {
  const project = await loadProject(projectId);
  const slug = project.slug;
  await setStatus(projectId, "deleting", "tearing down");

  // Best-effort container/volume teardown.
  try {
    await composeCli(composeFile(slug), ["down", "-v"], { timeoutMs: 180_000 });
  } catch (err) {
    console.warn(`[lifecycle] compose down failed for ${slug}:`, err);
  }

  // Drop tenant database + role.
  if (project.dbName && project.dbUser) {
    try {
      await dropTenantDatabase(project.dbName, project.dbUser);
    } catch (err) {
      console.warn(`[lifecycle] dropTenantDatabase failed for ${slug}:`, err);
    }
  }

  // Release resources.
  if (project.nodeId) {
    await decrementNodeUsage(project.nodeId, {
      ramMb: project.ramMbLimit ?? DEFAULTS.ramMb,
      vcpu: project.vcpuLimit ? Number(project.vcpuLimit) : DEFAULTS.vcpu,
      storageGb: project.storageGbLimit ?? DEFAULTS.storageGb,
    });
  }
  await releasePortAllocation(projectId);

  // Remove tenant data dir + project row.
  try {
    await rm(tenantDir(slug), { recursive: true, force: true });
  } catch (err) {
    console.warn(`[lifecycle] failed to remove tenant dir for ${slug}:`, err);
  }
  await db.delete(baasProjects).where(eq(baasProjects.id, projectId));
}
