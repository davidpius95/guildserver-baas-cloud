import { and, baasProjects, db, eq, isNotNull } from "./db";
import { dockerExec } from "./docker";
import { pauseProject } from "./project-lifecycle";

/**
 * Auto-pause active projects that have had no client activity for longer than
 * their idle timeout. Guarded to `status='active'` so it never touches a stopped
 * tenant's DB.
 */
export async function detectIdleProjects(): Promise<void> {
  const candidates = await db
    .select()
    .from(baasProjects)
    .where(
      and(eq(baasProjects.status, "active"), isNotNull(baasProjects.idleTimeoutMinutes)),
    );

  for (const project of candidates) {
    if (project.hostPortBase == null) continue;
    const container = `baas-${project.slug}-db`;

    // Count non-idle client connections via `docker exec` (local socket, trust auth) —
    // works whether the API runs as a host process or containerized.
    let activeConns = 0;
    try {
      const { stdout } = await dockerExec(container, [
        "psql",
        "-U",
        "supabase_admin",
        "-d",
        "postgres",
        "-tAc",
        "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND state <> 'idle' AND backend_type = 'client backend' AND pid <> pg_backend_pid()",
      ]);
      activeConns = Number(stdout.trim()) || 0;
    } catch {
      // If we can't reach the tenant DB, skip this cycle rather than mispause.
      continue;
    }

    const now = Date.now();
    if (activeConns > 0) {
      await db
        .update(baasProjects)
        .set({ lastActivityAt: new Date(), updatedAt: new Date() })
        .where(eq(baasProjects.id, project.id));
      continue;
    }

    const lastActivity = project.lastActivityAt?.getTime() ?? now;
    const idleMs = (project.idleTimeoutMinutes ?? 0) * 60_000;
    if (now - lastActivity > idleMs) {
      try {
        await pauseProject(project.id);
      } catch (err) {
        console.warn(`[idle-detector] failed to pause ${project.slug}:`, err);
      }
    }
  }
}
