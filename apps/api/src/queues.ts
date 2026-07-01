import { Queue } from "bullmq";
import { env } from "./env.js";

export const connection = { host: env.redis.host, port: env.redis.port };

/** Provision queue: provision/pause/resume/delete + branch jobs. */
export const provisionQueue = new Queue("baas-provision", { connection });

/** Backup queue: create/restore jobs. */
export const backupQueue = new Queue("baas-backup", { connection });

export type ProvisionJob =
  | { type: "provision"; projectId: string }
  | { type: "pause"; projectId: string }
  | { type: "resume"; projectId: string }
  | { type: "delete"; projectId: string }
  | { type: "branch-create"; projectId: string; branchName: string }
  | { type: "branch-delete"; projectId: string }
  | { type: "branch-merge"; projectId: string };

export type BackupJob =
  | { type: "create"; projectId: string; backupType?: "manual" | "automatic" }
  | { type: "restore"; backupId: string };

export function enqueueProvision(job: ProvisionJob) {
  return provisionQueue.add(job.type, job, {
    removeOnComplete: 100,
    removeOnFail: 500,
    attempts: 1,
  });
}

export function enqueueBackup(job: BackupJob) {
  return backupQueue.add(job.type, job, {
    removeOnComplete: 100,
    removeOnFail: 500,
    attempts: 1,
  });
}
