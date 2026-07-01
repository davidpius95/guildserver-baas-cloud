import postgres from "postgres";
import { config } from "./config";
import { decryptSecret } from "./crypto";
import { and, baasProjects, db, eq, isNotNull } from "./db";
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
    if (project.hostPortBase == null || !project.dbName || !project.dbUser || !project.dbPassword) {
      continue;
    }
    const dbPort = project.hostPortBase + 4; // PORT_OFFSETS.db
    const url = `postgres://${project.dbUser}:${decryptSecret(project.dbPassword)}@${config.tenantDbHost}:${dbPort}/${project.dbName}`;

    let activeConns = 0;
    const sqlc = postgres(url, { max: 1, connect_timeout: 5 });
    try {
      const [row] = await sqlc`
        SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE datname = current_database()
          AND state <> 'idle'
          AND backend_type = 'client backend'
          AND pid <> pg_backend_pid()
      `;
      activeConns = row?.n ?? 0;
    } catch {
      // If we can't reach the tenant DB, skip this cycle rather than mispause.
      await sqlc.end();
      continue;
    }
    await sqlc.end();

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
