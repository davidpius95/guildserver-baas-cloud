import { Worker } from "bullmq";
import {
  createBackup,
  createBranch,
  deleteBranch,
  deleteProject,
  mergeBranch,
  pauseProject,
  provisionProject,
  restoreBackup,
  resumeProject,
} from "@guildserver/baas-scheduler";
import { connection, type BackupJob, type ProvisionJob } from "./queues.js";

export function startWorkers(): { close: () => Promise<void> } {
  const provisionWorker = new Worker(
    "baas-provision",
    async (job) => {
      const data = job.data as ProvisionJob;
      switch (data.type) {
        case "provision":
          return provisionProject(data.projectId);
        case "pause":
          return pauseProject(data.projectId);
        case "resume":
          return resumeProject(data.projectId);
        case "delete":
          return deleteProject(data.projectId);
        case "branch-create":
          return createBranch(data.projectId, data.branchName);
        case "branch-delete":
          return deleteBranch(data.projectId);
        case "branch-merge":
          return mergeBranch(data.projectId);
        default:
          throw new Error(`Unknown provision job: ${(data as { type: string }).type}`);
      }
    },
    { connection, concurrency: 3 },
  );

  const backupWorker = new Worker(
    "baas-backup",
    async (job) => {
      const data = job.data as BackupJob;
      switch (data.type) {
        case "create":
          return createBackup(data.projectId, data.backupType ?? "manual");
        case "restore":
          return restoreBackup(data.backupId);
        default:
          throw new Error(`Unknown backup job: ${(data as { type: string }).type}`);
      }
    },
    { connection, concurrency: 2 },
  );

  for (const w of [provisionWorker, backupWorker]) {
    w.on("failed", (job, err) => {
      console.error(`[worker] ${w.name} job ${job?.name} (${job?.id}) failed:`, err.message);
    });
    w.on("completed", (job) => {
      console.log(`[worker] ${w.name} job ${job.name} (${job.id}) completed`);
    });
  }

  return {
    close: async () => {
      await Promise.all([provisionWorker.close(), backupWorker.close()]);
    },
  };
}
