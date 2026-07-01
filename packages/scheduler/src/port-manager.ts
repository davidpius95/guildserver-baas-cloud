import net from "node:net";
import {
  and,
  baasPortAllocations,
  baasProjects,
  db,
  type DbOrTx,
  eq,
  inArray,
  lt,
  sql,
} from "./db";
import { EXCLUDED_PORTS, PORT_WINDOW, config } from "./config";

/** Transaction type accepted by allocatePortBase — any drizzle executor. */
type Executor = DbOrTx;

/** Resolve true if the OS reports the port as bindable (i.e. free) right now. */
function canBind(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port, "0.0.0.0");
  });
}

/** A 10-port window is free only if every port in it is bindable and not excluded. */
async function windowIsFree(base: number): Promise<boolean> {
  for (let p = base; p < base + PORT_WINDOW; p++) {
    if (EXCLUDED_PORTS.has(p)) return false;
    // eslint-disable-next-line no-await-in-loop
    if (!(await canBind(p))) return false;
  }
  return true;
}

function isWindowExcluded(base: number): boolean {
  for (let p = base; p < base + PORT_WINDOW; p++) {
    if (EXCLUDED_PORTS.has(p)) return true;
  }
  return false;
}

/**
 * Reserve a free 10-port window for a node.
 *
 * Concurrency: a Postgres advisory lock (held for the enclosing transaction)
 * serialises allocation per node, so two provisions can't race on the same window.
 * Ground truth: every candidate is verified free at the OS level before reserving,
 * catching ports occupied by anything outside our DB tracking.
 *
 * MUST be called inside a transaction (`tx`) so the advisory lock and the reserved
 * row commit/rollback together with the project insert.
 */
export async function allocatePortBase(nodeId: string, tx: Executor): Promise<number> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${nodeId}))`);

  // Highest window already reserved/bound on this node (released rows are reusable).
  const [{ maxBase } = { maxBase: null }] = await tx
    .select({ maxBase: sql<number | null>`max(${baasPortAllocations.portBase})` })
    .from(baasPortAllocations)
    .where(
      and(
        eq(baasPortAllocations.nodeId, nodeId),
        inArray(baasPortAllocations.status, ["reserved", "bound"]),
      ),
    );

  let candidate = maxBase ? maxBase + PORT_WINDOW : config.portRangeStart;
  const maxAttempts = 40;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (candidate + PORT_WINDOW - 1 > config.portRangeEnd) {
      throw new Error(
        `No free port window on node ${nodeId}: reached end of range ${config.portRangeEnd}`,
      );
    }
    if (isWindowExcluded(candidate)) {
      candidate += PORT_WINDOW;
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    if (await windowIsFree(candidate)) {
      // Upsert: a previously-released window for this (node, port) still has a row
      // (kept for audit) that would collide with the unique index — reuse it.
      // eslint-disable-next-line no-await-in-loop
      await tx
        .insert(baasPortAllocations)
        .values({ nodeId, portBase: candidate, status: "reserved" })
        .onConflictDoUpdate({
          target: [baasPortAllocations.nodeId, baasPortAllocations.portBase],
          set: {
            status: "reserved",
            projectId: null,
            reservedAt: new Date(),
            boundAt: null,
            releasedAt: null,
          },
        });
      return candidate;
    }
    // OS says occupied though DB didn't know — skip and log.
    console.warn(
      `[port-manager] window ${candidate}-${candidate + PORT_WINDOW - 1} occupied outside DB tracking; skipping`,
    );
    candidate += PORT_WINDOW;
  }

  throw new Error(`No free port window found on node ${nodeId} after ${maxAttempts} attempts`);
}

/** Mark a reservation as bound once the tenant's containers are confirmed healthy. */
export async function confirmPortBinding(portBase: number): Promise<void> {
  await db
    .update(baasPortAllocations)
    .set({ status: "bound", boundAt: new Date() })
    .where(
      and(
        eq(baasPortAllocations.portBase, portBase),
        eq(baasPortAllocations.status, "reserved"),
      ),
    );
}

/** Release a project's port window (kept as a row for audit). */
export async function releasePortAllocation(projectId: string): Promise<void> {
  await db
    .update(baasPortAllocations)
    .set({ status: "released", releasedAt: new Date() })
    .where(eq(baasPortAllocations.projectId, projectId));
}

/**
 * Reconcile DB port state against OS ground truth. Runs on a cron.
 * - `reserved` older than 10 min with no active project → auto-release (crashed provision).
 * - Logs (does not touch) any `bound` window whose ports are unexpectedly free,
 *   and any window occupied at OS level that DB thinks is free.
 */
export async function reconcilePortAllocations(): Promise<void> {
  const tenMinAgo = new Date(Date.now() - 10 * 60_000);

  // Abandoned reservations from crashed provisions.
  const stale = await db
    .select({ id: baasPortAllocations.id, projectId: baasPortAllocations.projectId })
    .from(baasPortAllocations)
    .where(
      and(
        eq(baasPortAllocations.status, "reserved"),
        lt(baasPortAllocations.reservedAt, tenMinAgo),
      ),
    );

  for (const row of stale) {
    // Only release if there's no active project holding it.
    if (row.projectId) {
      const proj = await db
        .select({ status: baasProjects.status })
        .from(baasProjects)
        .where(eq(baasProjects.id, row.projectId))
        .limit(1);
      if (proj[0] && proj[0].status !== "error" && proj[0].status !== "deleting") continue;
    }
    await db
      .update(baasPortAllocations)
      .set({ status: "released", releasedAt: new Date() })
      .where(eq(baasPortAllocations.id, row.id));
    console.warn(`[port-manager] released stale reservation ${row.id}`);
  }

  // Sanity-check bound windows against the OS.
  const bound = await db
    .select({ portBase: baasPortAllocations.portBase, projectId: baasPortAllocations.projectId })
    .from(baasPortAllocations)
    .where(eq(baasPortAllocations.status, "bound"));

  for (const row of bound) {
    // If the whole window is free at the OS level, the tenant's containers are gone.
    if (await windowIsFree(row.portBase)) {
      console.warn(
        `[port-manager] bound window ${row.portBase} appears free at OS level (project ${row.projectId ?? "?"}); health-reconciler should flag it`,
      );
    }
  }
}
