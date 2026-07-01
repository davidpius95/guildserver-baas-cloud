import cron from "node-cron";
import {
  baasProjects,
  db,
  eq,
} from "@guildserver/baas-db";
import {
  collectAllMetrics,
  createBackup,
  detectIdleProjects,
  evaluateAllScaling,
  pruneOldMetrics,
  reconcileNodes,
  reconcilePortAllocations,
  reconcileProjects,
  sweepExpiredBackups,
} from "@guildserver/baas-scheduler";

const tasks: ReturnType<typeof cron.schedule>[] = [];

function schedule(expr: string, name: string, fn: () => Promise<unknown>) {
  const task = cron.schedule(expr, async () => {
    try {
      await fn();
    } catch (err) {
      console.error(`[cron] ${name} failed:`, err instanceof Error ? err.message : err);
    }
  });
  tasks.push(task);
}

async function autoBackupAll() {
  const projects = await db
    .select({ id: baasProjects.id })
    .from(baasProjects)
    .where(eq(baasProjects.status, "active"));
  for (const p of projects) {
    try {
      await createBackup(p.id, "automatic");
    } catch (err) {
      console.error(`[cron] auto-backup ${p.id} failed:`, err instanceof Error ? err.message : err);
    }
  }
}

export function startCrons(): { stop: () => void } {
  // Every 30s — health + port reconciliation.
  schedule("*/30 * * * * *", "reconcile", async () => {
    await reconcileNodes();
    await reconcileProjects();
    await reconcilePortAllocations();
  });
  // Every 5m — idle detection.
  schedule("*/5 * * * *", "idle-detect", detectIdleProjects);
  // Every 2m — metrics.
  schedule("*/2 * * * *", "metrics", collectAllMetrics);
  // Every 10m — auto-scaling.
  schedule("*/10 * * * *", "auto-scale", evaluateAllScaling);
  // Daily 03:00 — auto-backup; 04:00 — sweep; 04:30 — prune metrics.
  schedule("0 3 * * *", "auto-backup", autoBackupAll);
  schedule("0 4 * * *", "sweep-backups", sweepExpiredBackups);
  schedule("30 4 * * *", "prune-metrics", pruneOldMetrics);

  return {
    stop: () => {
      for (const t of tasks) t.stop();
    },
  };
}
