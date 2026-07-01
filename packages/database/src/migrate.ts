import os from "node:os";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { baasNodes } from "./schema";

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");

  // A dedicated single connection for migrations.
  const migrationClient = postgres(connectionString, { max: 1 });
  const db = drizzle(migrationClient);

  console.log("[migrate] running drizzle migrations…");
  await migrate(db, { migrationsFolder: `${__dirname}/../migrations` });
  console.log("[migrate] migrations applied");

  // Seed exactly one local compute node (single-node v1) if none exists.
  const existing = await db
    .select({ id: baasNodes.id })
    .from(baasNodes)
    .where(sql`role = 'compute'`)
    .limit(1);

  if (existing.length === 0) {
    // Reserve a slice of the host for the platform/PaaS; the rest is schedulable.
    const totalRamMb = Math.floor(os.totalmem() / (1024 * 1024));
    const totalVcpu = os.cpus().length;
    const schedulableRamMb = Number(
      process.env.BAAS_NODE_RAM_MB ?? Math.floor(totalRamMb * 0.6),
    );
    const schedulableVcpu = Number(process.env.BAAS_NODE_VCPU ?? Math.max(1, totalVcpu - 1));
    const storageGb = Number(process.env.BAAS_NODE_STORAGE_GB ?? 200);

    await db.insert(baasNodes).values({
      name: "local",
      hostname: os.hostname(),
      internalIp: "127.0.0.1",
      role: "compute",
      status: "online",
      vcpuTotal: schedulableVcpu,
      ramMbTotal: schedulableRamMb,
      storageGbTotal: storageGb,
      lastHeartbeat: new Date(),
      metadata: { seededBy: "migrate", totalRamMb, totalVcpu },
    });
    console.log(
      `[migrate] seeded local compute node (vcpu=${schedulableVcpu}, ram=${schedulableRamMb}MB, storage=${storageGb}GB)`,
    );
  } else {
    console.log("[migrate] compute node already present — skipping seed");
  }

  await migrationClient.end();
  console.log("[migrate] done");
}

main().catch((err) => {
  console.error("[migrate] failed:", err);
  process.exit(1);
});
