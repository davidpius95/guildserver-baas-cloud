import { writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "./config";
import { and, baasMetrics, baasProjects, baasScalingEvents, db, desc, eq } from "./db";
import { composeCli, dockerCli } from "./docker";
import { generatePostgresqlConf } from "./compose-template";

const COOLDOWN_MS = 20 * 60_000; // 20 minutes
const RAM_RESTART_THRESHOLD = 0.15; // rewrite conf + restart when RAM change > 15%
const WINDOW = 10; // rolling window of metrics rows

function tenantDir(slug: string): string {
  return path.join(config.tenantDataDir, `baas-${slug}`);
}

interface Decision {
  direction: "up" | "down" | "none";
  newVcpu: number;
  newRamMb: number;
  reason: string;
}

function decide(
  metrics: { cpuPercent: string | null; ramMbUsed: number | null }[],
  curVcpu: number,
  curRamMb: number,
  bounds: { minVcpu: number; maxVcpu: number; minRamMb: number; maxRamMb: number },
): Decision {
  if (metrics.length < 3) return { direction: "none", newVcpu: curVcpu, newRamMb: curRamMb, reason: "insufficient data" };
  const cpus = metrics.map((m) => Number(m.cpuPercent ?? 0));
  const ramPct = metrics.map((m) => (curRamMb > 0 ? ((m.ramMbUsed ?? 0) / curRamMb) * 100 : 0));
  const avgCpu = cpus.reduce((a, b) => a + b, 0) / cpus.length;
  const avgRamPct = ramPct.reduce((a, b) => a + b, 0) / ramPct.length;

  const highCpu = cpus.slice(0, 3).every((c) => c > 80);
  const highRam = ramPct.slice(0, 3).every((r) => r > 85);
  const lowCpu = cpus.length >= 10 && cpus.slice(0, 10).every((c) => c < 20);
  const lowRam = ramPct.length >= 10 && ramPct.slice(0, 10).every((r) => r < 30);

  if (highCpu || highRam) {
    return {
      direction: "up",
      newVcpu: Math.min(bounds.maxVcpu, Math.round(curVcpu * 1.5 * 100) / 100),
      newRamMb: Math.min(bounds.maxRamMb, Math.floor(curRamMb * 1.5)),
      reason: `scale up (avgCpu=${avgCpu.toFixed(0)}% avgRam=${avgRamPct.toFixed(0)}%)`,
    };
  }
  if (lowCpu && lowRam) {
    return {
      direction: "down",
      newVcpu: Math.max(bounds.minVcpu, Math.round(curVcpu * 0.75 * 100) / 100),
      newRamMb: Math.max(bounds.minRamMb, Math.floor(curRamMb * 0.75)),
      reason: `scale down (avgCpu=${avgCpu.toFixed(0)}% avgRam=${avgRamPct.toFixed(0)}%)`,
    };
  }
  return { direction: "none", newVcpu: curVcpu, newRamMb: curRamMb, reason: "within bounds" };
}

export async function evaluateScaling(projectId: string): Promise<void> {
  const rows = await db.select().from(baasProjects).where(eq(baasProjects.id, projectId)).limit(1);
  const project = rows[0];
  if (!project || project.status !== "active" || project.scalingMode !== "auto") return;

  // Cooldown.
  if (project.lastScaledAt && Date.now() - project.lastScaledAt.getTime() < COOLDOWN_MS) return;

  const curVcpu = project.vcpuLimit ? Number(project.vcpuLimit) : 1;
  const curRamMb = project.ramMbLimit ?? 1024;
  const bounds = {
    minVcpu: project.minVcpu ? Number(project.minVcpu) : 0.5,
    maxVcpu: project.maxVcpu ? Number(project.maxVcpu) : Math.max(curVcpu, 4),
    minRamMb: project.minRamMb ?? 512,
    maxRamMb: project.maxRamMb ?? Math.max(curRamMb, 4096),
  };

  const metrics = await db
    .select({ cpuPercent: baasMetrics.cpuPercent, ramMbUsed: baasMetrics.ramMbUsed })
    .from(baasMetrics)
    .where(eq(baasMetrics.projectId, projectId))
    .orderBy(desc(baasMetrics.collectedAt))
    .limit(WINDOW);

  const decision = decide(metrics, curVcpu, curRamMb, bounds);
  if (decision.direction === "none") return;
  if (decision.newVcpu === curVcpu && decision.newRamMb === curRamMb) return;

  const dbContainer = `baas-${project.slug}-db`;
  const restContainer = `baas-${project.slug}-rest`;
  const authContainer = `baas-${project.slug}-auth`;

  // Always apply live limits (immediate, no downtime).
  const memBytes = decision.newRamMb * 1024 * 1024;
  const cpuQuota = Math.floor(decision.newVcpu * 100_000);
  for (const c of [dbContainer, restContainer, authContainer]) {
    try {
      await dockerCli(["update", "--cpus", String(decision.newVcpu), "--memory", `${memBytes}`, c]);
    } catch (err) {
      console.warn(`[auto-scaler] docker update failed for ${c}:`, err);
    }
  }
  void cpuQuota;

  // shared_buffers only takes effect on restart — rewrite conf + restart db if RAM moved enough.
  const ramChange = Math.abs(decision.newRamMb / curRamMb - 1);
  let restarted = false;
  if (ramChange > RAM_RESTART_THRESHOLD) {
    try {
      await writeFile(
        path.join(tenantDir(project.slug), "postgresql.conf"),
        generatePostgresqlConf(decision.newRamMb, project.walArchiveEnabled),
      );
      await composeCli(path.join(tenantDir(project.slug), "docker-compose.yml"), ["restart", "db"]);
      restarted = true;
    } catch (err) {
      console.warn(`[auto-scaler] conf rewrite/restart failed for ${project.slug}:`, err);
    }
  }

  await db.insert(baasScalingEvents).values({
    projectId,
    direction: decision.direction,
    prevVcpu: String(curVcpu),
    newVcpu: String(decision.newVcpu),
    prevRamMb: curRamMb,
    newRamMb: decision.newRamMb,
    restarted,
    reason: decision.reason,
  });

  await db
    .update(baasProjects)
    .set({
      vcpuLimit: String(decision.newVcpu),
      ramMbLimit: decision.newRamMb,
      lastScaledAt: new Date(),
      statusMessage: `${decision.reason}${restarted ? " (restarted)" : ""}`,
      updatedAt: new Date(),
    })
    .where(eq(baasProjects.id, projectId));
}

export async function evaluateAllScaling(): Promise<void> {
  const autos = await db
    .select({ id: baasProjects.id })
    .from(baasProjects)
    .where(and(eq(baasProjects.status, "active"), eq(baasProjects.scalingMode, "auto")));
  await Promise.allSettled(autos.map((p) => evaluateScaling(p.id)));
}
