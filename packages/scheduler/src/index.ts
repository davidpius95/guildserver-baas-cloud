// Barrel export for the scheduler package.
// import { provisionProject, createBackup, ... } from "@guildserver/baas-scheduler";

export { config, EXCLUDED_PORTS, PORT_WINDOW } from "./config";
export { assertEncryptionKey, encryptSecret, decryptSecret, decryptNullable } from "./crypto";
export { generateProjectSecrets, type ProjectSecrets } from "./secrets";
export {
  generateComposeYml,
  generateKongConfig,
  generatePostgresqlConf,
  generateVectorConfig,
  IMAGES,
  PORT_OFFSETS,
  type ProjectComposeConfig,
} from "./compose-template";
export {
  allocatePortBase,
  confirmPortBinding,
  releasePortAllocation,
  reconcilePortAllocations,
} from "./port-manager";
export {
  selectNode,
  nodeHasCapacity,
  incrementNodeUsage,
  decrementNodeUsage,
  type NodeSelection,
} from "./node-selector";
export {
  provisionProject,
  pauseProject,
  resumeProject,
  deleteProject,
  wakeProject,
} from "./project-lifecycle";
export { createBackup, restoreBackup, sweepExpiredBackups } from "./backup-orchestrator";
export { createBranch, deleteBranch, mergeBranch } from "./branch-manager";
export { evaluateScaling, evaluateAllScaling } from "./auto-scaler";
export { reconcileNodes, reconcileProjects } from "./health-reconciler";
export { detectIdleProjects } from "./idle-detector";
export { collectAllMetrics, collectProjectMetrics, pruneOldMetrics } from "./metrics-collector";
export { docker, dockerCli, composeCli, containerExists, containerRunning, dockerExec } from "./docker";
