import { baasNodes, baasProjects, db, eq, ne, sql } from "./db";
import { containerRunning, docker } from "./docker";

/** Core containers every active tenant must have running. */
const CORE_SERVICES = ["db", "kong", "auth", "rest"];

/**
 * For each active project, verify its core containers are running.
 * If any are missing/stopped, flag the project as `error` listing them.
 */
export async function reconcileProjects(): Promise<void> {
  const active = await db
    .select({ id: baasProjects.id, slug: baasProjects.slug })
    .from(baasProjects)
    .where(eq(baasProjects.status, "active"));

  for (const project of active) {
    const missing: string[] = [];
    for (const svc of CORE_SERVICES) {
      const running = await containerRunning(`baas-${project.slug}-${svc}`);
      if (running !== true) missing.push(svc);
    }
    if (missing.length > 0) {
      await db
        .update(baasProjects)
        .set({
          status: "error",
          statusMessage: `containers down: ${missing.join(", ")}`,
          updatedAt: new Date(),
        })
        .where(eq(baasProjects.id, project.id));
    }
  }
}

/**
 * Single-node reconcile: confirm the local Docker daemon is reachable and mark
 * the node online; on failure mark it error.
 */
export async function reconcileNodes(): Promise<void> {
  let reachable = true;
  try {
    await docker.ping();
  } catch {
    reachable = false;
  }

  await db
    .update(baasNodes)
    .set({
      status: reachable ? "online" : "error",
      lastHeartbeat: new Date(),
      updatedAt: new Date(),
    })
    .where(ne(baasNodes.status, "maintenance"));
}
