import { baasMetrics, baasProjects, db, eq, lt } from "./db";
import { docker, dockerExec } from "./docker";

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

  // Query pg_stat_database via `docker exec` into the tenant DB container (local unix
  // socket, trust auth) rather than a TCP connection — the API may run containerized
  // on a different docker network and can't reach the tenant's host-published port.
  try {
    const { stdout } = await dockerExec(container, [
      "psql",
      "-U",
      "supabase_admin",
      "-d",
      "postgres",
      "-tAF|",
      "-c",
      "SELECT numbackends, xact_commit, xact_rollback, pg_database_size(current_database()) FROM pg_stat_database WHERE datname = current_database()",
    ]);
    const parts = stdout.trim().split("|");
    if (parts.length >= 4) {
      activeConnections = Number(parts[0]);
      txCommitted = Number(parts[1]);
      txRolledBack = Number(parts[2]);
      dbSizeMb = (Number(parts[3]) / (1024 * 1024)).toFixed(2);
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
