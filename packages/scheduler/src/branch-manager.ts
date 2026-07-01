import { randomBytes } from "node:crypto";
import path from "node:path";
import { config } from "./config";
import { baasProjects, db, eq } from "./db";
import { composeCli, dockerCli, dockerExec } from "./docker";
import { createBackup } from "./backup-orchestrator";
import { deleteProject, provisionProject } from "./project-lifecycle";

function tenantComposeFile(slug: string): string {
  return path.join(config.tenantDataDir, `baas-${slug}`, "docker-compose.yml");
}

async function loadProject(projectId: string) {
  const rows = await db.select().from(baasProjects).where(eq(baasProjects.id, projectId)).limit(1);
  const p = rows[0];
  if (!p) throw new Error(`Project ${projectId} not found`);
  return p;
}

/**
 * Create a branch: a full new tenant stack seeded with a snapshot of the parent's DB.
 * The API creates the branch project row first (status=provisioning, parentProjectId set);
 * this provisions it and copies the parent data in.
 */
export async function createBranch(branchProjectId: string, _branchName: string): Promise<void> {
  const before = await loadProject(branchProjectId);
  if (!before.parentProjectId) throw new Error(`Project ${branchProjectId} has no parentProjectId`);
  const parent = await loadProject(before.parentProjectId);

  // 1. Provision the branch stack (fresh, empty tenant DB).
  await provisionProject(branchProjectId);

  // 2. Reload the branch — provisionProject populated its dbUser/dbName/slug.
  const branch = await loadProject(branchProjectId);

  // 3. Dump parent → restore into branch.
  await copyDatabase(parent.slug, parent.dbUser!, parent.dbName!, branch.slug, branch.dbUser!, branch.dbName!);
}

export async function deleteBranch(branchProjectId: string): Promise<void> {
  const branch = await loadProject(branchProjectId);
  if (!branch.parentProjectId) {
    throw new Error(`Refusing to delete ${branchProjectId}: not a branch (no parentProjectId)`);
  }
  await deleteProject(branchProjectId);
}

/**
 * Merge a branch back into its parent: DESTRUCTIVE full replace of the parent DB.
 * A pre_merge safety snapshot of the parent is taken first, so the parent is a
 * restoreBackup() away from recoverable.
 */
export async function mergeBranch(branchProjectId: string): Promise<void> {
  const branch = await loadProject(branchProjectId);
  if (!branch.parentProjectId) throw new Error(`Project ${branchProjectId} is not a branch`);
  const parent = await loadProject(branch.parentProjectId);

  // Safety snapshot of the parent before we overwrite it.
  await createBackup(parent.id, "pre_merge");

  // Replace parent DB with branch DB contents.
  await copyDatabase(branch.slug, branch.dbUser!, branch.dbName!, parent.slug, parent.dbUser!, parent.dbName!);

  // Tear the branch down.
  await deleteProject(branchProjectId);
}

/** pg_dump from source tenant → pg_restore into dest tenant (full replace of dest DB). */
async function copyDatabase(
  srcSlug: string,
  srcUser: string,
  srcDb: string,
  dstSlug: string,
  dstUser: string,
  dstDb: string,
): Promise<void> {
  const srcContainer = `baas-${srcSlug}-db`;
  const dstContainer = `baas-${dstSlug}-db`;
  const dumpName = `/tmp/branch-${randomBytes(6).toString("hex")}.dump`;

  // Dump inside source container.
  await dockerExec(srcContainer, ["pg_dump", "-U", srcUser, "-d", srcDb, "-Fc", "-f", dumpName]);
  // Move dump host→dest via docker cp (through the host).
  const hostTmp = path.join("/tmp", path.basename(dumpName));
  await dockerCli(["cp", `${srcContainer}:${dumpName}`, hostTmp]);
  await dockerCli(["cp", hostTmp, `${dstContainer}:${dumpName}`]);

  // Recreate dest DB and restore.
  await dockerExec(dstContainer, [
    "psql",
    "-U",
    dstUser,
    "-d",
    "postgres",
    "-c",
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${dstDb}' AND pid<>pg_backend_pid();`,
  ]);
  await dockerExec(dstContainer, ["psql", "-U", dstUser, "-d", "postgres", "-c", `DROP DATABASE IF EXISTS "${dstDb}";`]);
  await dockerExec(dstContainer, ["psql", "-U", dstUser, "-d", "postgres", "-c", `CREATE DATABASE "${dstDb}" OWNER "${dstUser}";`]);
  await dockerExec(dstContainer, ["pg_restore", "-U", dstUser, "-d", dstDb, "--no-owner", dumpName]);

  // Cleanup + reconnect dest services.
  await dockerExec(srcContainer, ["rm", "-f", dumpName]);
  await dockerExec(dstContainer, ["rm", "-f", dumpName]);
  await composeCli(tenantComposeFile(dstSlug), ["restart", "rest", "auth", "realtime", "storage", "meta"]);
}
