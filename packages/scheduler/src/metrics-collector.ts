import postgres from "postgres";
import { decryptSecret } from "./crypto";
import { baasMetrics, baasProjects, db, eq, lt } from "./db";
import { docker } from "./docker";

interface DockerStats {
  cpu_stats: {
    cpu_usage: { total_usage: number };
    system_cpu_usage: number;
    online_cpus?: number;
  };
  precpu_stats: {
    cpu_usage: { total_usage: number };
    system_cpu_usage: number;
  };
  memory_stats: { usage?: number };
}

function cpuPercent(stats: DockerStats): number {
  const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
  const sysDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
  const cpus = stats.cpu_stats.online_cpus ?? 1;
  if (sysDelta <= 0 || cpuDelta <= 0) return 0;
  return (cpuDelta / sysDelta) * cpus * 100;
}

/** Tenant admin connection URL through the platform Postgres is not used here;
 * instead we exec against the tenant DB container via its published host port. */
function tenantDbUrl(hostPortBase: number, dbUser: string, dbPassword: string, dbName: string): string {
  const dbPort = hostPortBase + 4; // PORT_OFFSETS.db
  return `postgres://${dbUser}:${dbPassword}@localhost:${dbPort}/${dbName}`;
}

export async function collectProjectMetrics(projectId: string): Promise<void> {
  const rows = await db.select().from(baasProjects).where(eq(baasProjects.id, projectId)).limit(1);
  const project = rows[0];
  if (!project || project.status !== "active" || project.hostPortBase == null) return;

  const container = `baas-${project.slug}-db`;
  let cpu = 0;
  let ramMb = 0;
  try {
    const stats = (await docker.getContainer(container).stats({ stream: false })) as unknown as DockerStats;
    cpu = cpuPercent(stats);
    ramMb = Math.floor((stats.memory_stats.usage ?? 0) / (1024 * 1024));
  } catch {
    // container stats unavailable — record zeros
  }

  let activeConnections: number | null = null;
  let dbSizeMb: string | null = null;
  let txCommitted: number | null = null;
  let txRolledBack: number | null = null;

  // Query pg_stat_database via the tenant DB's published port using decrypted creds.
  // Note: caller passes decrypted values through project row? Secrets are encrypted, so
  // metrics DB stats are best-effort and skipped if creds unavailable at this layer.
  try {
    if (project.dbName && project.dbUser && project.dbPassword) {
      // dbPassword is stored encrypted — decrypt to read pg_stat_database.
      const url = tenantDbUrl(
        project.hostPortBase,
        project.dbUser,
        decryptSecret(project.dbPassword),
        project.dbName,
      );
      const sqlc = postgres(url, { max: 1, connect_timeout: 5 });
      try {
        const [stat] = await sqlc`
          SELECT numbackends, xact_commit, xact_rollback,
                 pg_database_size(current_database()) AS size_bytes
          FROM pg_stat_database WHERE datname = current_database()
        `;
        if (stat) {
          activeConnections = Number(stat.numbackends);
          txCommitted = Number(stat.xact_commit);
          txRolledBack = Number(stat.xact_rollback);
          dbSizeMb = (Number(stat.size_bytes) / (1024 * 1024)).toFixed(2);
        }
      } finally {
        await sqlc.end();
      }
    }
  } catch {
    // best-effort
  }

  await db.insert(baasMetrics).values({
    projectId,
    cpuPercent: cpu.toFixed(2),
    ramMbUsed: ramMb,
    activeConnections,
    dbSizeMb,
    txCommitted,
    txRolledBack,
  });
}

export async function collectAllMetrics(): Promise<void> {
  const active = await db
    .select({ id: baasProjects.id })
    .from(baasProjects)
    .where(eq(baasProjects.status, "active"));
  await Promise.allSettled(active.map((p) => collectProjectMetrics(p.id)));
}

export async function pruneOldMetrics(): Promise<number> {
  const cutoff = new Date(Date.now() - 30 * 86_400_000);
  const deleted = await db
    .delete(baasMetrics)
    .where(lt(baasMetrics.collectedAt, cutoff))
    .returning({ id: baasMetrics.id });
  return deleted.length;
}
