import { authRouter } from "../routers/auth.js";
import { backupRouter } from "../routers/backup.js";
import { branchRouter } from "../routers/branch.js";
import { domainRouter } from "../routers/domain.js";
import { metricsRouter } from "../routers/metrics.js";
import { nodeRouter } from "../routers/node.js";
import { organizationRouter } from "../routers/organization.js";
import { projectRouter } from "../routers/project.js";
import { router } from "./trpc.js";

export const appRouter = router({
  auth: authRouter,
  organization: organizationRouter,
  project: projectRouter,
  backup: backupRouter,
  domain: domainRouter,
  node: nodeRouter,
  metrics: metricsRouter,
  branch: branchRouter,
});

export type AppRouter = typeof appRouter;
