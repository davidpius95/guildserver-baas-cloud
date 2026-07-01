import { and, baasNodes, db, type DbOrTx, eq, sql } from "./db";

export interface NodeSelection {
  id: string;
  hostname: string;
  vcpuTotal: number;
  ramMbTotal: number;
  storageGbTotal: number;
  vcpuUsed: number;
  ramMbUsed: number;
  storageGbUsed: number;
}

type Executor = DbOrTx;

/**
 * Single-node v1: return the one online compute node.
 * (When multi-node lands this grows scoring/filtering; the signature stays.)
 */
export async function selectNode(tx: Executor = db): Promise<NodeSelection> {
  const rows = await tx
    .select()
    .from(baasNodes)
    .where(and(eq(baasNodes.role, "compute"), eq(baasNodes.status, "online")))
    .limit(1);

  const node = rows[0];
  if (!node) {
    throw new Error("No online compute node available");
  }
  return {
    id: node.id,
    hostname: node.hostname,
    vcpuTotal: node.vcpuTotal,
    ramMbTotal: node.ramMbTotal,
    storageGbTotal: node.storageGbTotal,
    vcpuUsed: node.vcpuUsed,
    ramMbUsed: node.ramMbUsed,
    storageGbUsed: node.storageGbUsed,
  };
}

/** True if the node can fit the requested resources on top of current usage. */
export function nodeHasCapacity(
  node: NodeSelection,
  req: { ramMb: number; vcpu: number; storageGb: number },
): boolean {
  return (
    node.ramMbUsed + req.ramMb <= node.ramMbTotal &&
    node.vcpuUsed + req.vcpu <= node.vcpuTotal &&
    node.storageGbUsed + req.storageGb <= node.storageGbTotal
  );
}

/** Atomically add to a node's usage counters (called inside the provision txn). */
export async function incrementNodeUsage(
  nodeId: string,
  delta: { ramMb: number; vcpu: number; storageGb: number },
  tx: Executor = db,
): Promise<void> {
  await tx
    .update(baasNodes)
    .set({
      ramMbUsed: sql`${baasNodes.ramMbUsed} + ${delta.ramMb}`,
      vcpuUsed: sql`${baasNodes.vcpuUsed} + ${Math.ceil(delta.vcpu)}`,
      storageGbUsed: sql`${baasNodes.storageGbUsed} + ${delta.storageGb}`,
      updatedAt: new Date(),
    })
    .where(eq(baasNodes.id, nodeId));
}

/** Atomically subtract from a node's usage counters (never below zero). */
export async function decrementNodeUsage(
  nodeId: string,
  delta: { ramMb: number; vcpu: number; storageGb: number },
  tx: Executor = db,
): Promise<void> {
  await tx
    .update(baasNodes)
    .set({
      ramMbUsed: sql`greatest(0, ${baasNodes.ramMbUsed} - ${delta.ramMb})`,
      vcpuUsed: sql`greatest(0, ${baasNodes.vcpuUsed} - ${Math.ceil(delta.vcpu)})`,
      storageGbUsed: sql`greatest(0, ${baasNodes.storageGbUsed} - ${delta.storageGb})`,
      updatedAt: new Date(),
    })
    .where(eq(baasNodes.id, nodeId));
}
