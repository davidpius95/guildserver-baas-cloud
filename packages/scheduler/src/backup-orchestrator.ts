import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { config } from "./config";
import { and, baasBackups, baasProjects, db, eq, lt, sql } from "./db";
import { composeCli, dockerCli, dockerExec } from "./docker";

type BackupType = "manual" | "automatic" | "pre_merge" | "base";

function backupDir(slug: string): string {
  return path.join(config.backupDir, slug);
}

function tenantComposeFile(slug: string): string {
  return path.join(config.tenantDataDir, `baas-${slug}`, "docker-compose.yml");
}

async function loadProject(projectId: string) {
  const rows = await db.select().from(baasProjects).where(eq(baasProjects.id, projectId)).limit(1);
  const p = rows[0];
  if (!p) throw new Error(`Project ${projectId} not found`);
  return p;
}

/** Stream `pg_dump -Fc` from the tenant DB container to a file. */
function streamPgDump(container: string, dbUser: string, dbName: string, outPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const out = createWriteStream(outPath);
    const child = spawn("docker", ["exec", container, "pg_dump", "-U", dbUser, "-d", dbName, "-Fc"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stdout.pipe(out);
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      out.close();
      if (code === 0) resolve();
      else reject(new Error(`pg_dump exited ${code}: ${stderr}`));
    });
  });
}

export async function createBackup(projectId: string, type: BackupType = "manual"): Promise<string> {
  const project = await loadProject(projectId);
  const slug = project.slug;
  const dbUser = project.dbUser ?? "postgres";
  const dbName = project.dbName ?? "postgres";
  const container = `baas-${slug}-db`;

  const [row] = await db
    .insert(baasBackups)
    .values({ projectId, backupType: type, status: "in_progress", startedAt: new Date() })
    .returning({ id: baasBackups.id });

  const dir = backupDir(slug);
  await mkdir(dir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const filePath = path.join(dir, `${ts}.dump`);

  try {
    await streamPgDump(container, dbUser, dbName, filePath);
    const { size } = await stat(filePath);
    const retentionDays = project.backupRetentionDays ?? 7;
    const expiresAt = new Date(Date.now() + retentionDays * 86_400_000);
    await db
      .update(baasBackups)
      .set({ status: "completed", sizeBytes: size, filePath, completedAt: new Date(), expiresAt })
      .where(eq(baasBackups.id, row.id));
    return row.id;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(baasBackups)
      .set({ status: "failed", error: message, completedAt: new Date() })
      .where(eq(baasBackups.id, row.id));
    throw err;
  }
}

export async function restoreBackup(backupId: string): Promise<void> {
  const rows = await db.select().from(baasBackups).where(eq(baasBackups.id, backupId)).limit(1);
  const backup = rows[0];
  if (!backup || !backup.filePath) throw new Error(`Backup ${backupId} not found or has no file`);
  const project = await loadProject(backup.projectId);
  const slug = project.slug;
  const dbUser = project.dbUser ?? "postgres";
  const dbName = project.dbName ?? "postgres";
  const container = `baas-${slug}-db`;
  const composeFile = tenantComposeFile(slug);

  // Copy dump into the container.
  const inContainerPath = `/tmp/restore-${path.basename(backup.filePath)}`;
  await dockerCli(["cp", backup.filePath, `${container}:${inContainerPath}`]);

  // Terminate connections, drop + recreate the database, then restore.
  await dockerExec(container, [
    "psql",
    "-U",
    dbUser,
    "-d",
    "postgres",
    "-c",
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${dbName}' AND pid<>pg_backend_pid();`,
  ]);
  await dockerExec(container, ["psql", "-U", dbUser, "-d", "postgres", "-c", `DROP DATABASE IF EXISTS "${dbName}";`]);
  await dockerExec(container, ["psql", "-U", dbUser, "-d", "postgres", "-c", `CREATE DATABASE "${dbName}" OWNER "${dbUser}";`]);
  await dockerExec(container, ["pg_restore", "-U", dbUser, "-d", dbName, "--no-owner", inContainerPath]);
  await dockerExec(container, ["rm", "-f", inContainerPath]);

  // Restart dependent services to reconnect cleanly.
  await composeCli(composeFile, ["restart", "rest", "auth", "realtime", "storage", "meta"]);
}

export async function sweepExpiredBackups(): Promise<number> {
  const expired = await db
    .select({ id: baasBackups.id, filePath: baasBackups.filePath })
    .from(baasBackups)
    .where(and(eq(baasBackups.status, "completed"), lt(baasBackups.expiresAt, new Date())));

  let removed = 0;
  for (const b of expired) {
    if (b.filePath) {
      try {
        await rm(b.filePath, { force: true });
      } catch (err) {
        console.warn(`[backup] failed to remove ${b.filePath}:`, err);
      }
    }
    await db.delete(baasBackups).where(eq(baasBackups.id, b.id));
    removed += 1;
  }
  return removed;
}
