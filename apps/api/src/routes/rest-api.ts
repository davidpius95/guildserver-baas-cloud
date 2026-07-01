import { Router } from "express";
import type { Request, Response } from "express";
import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import { TRPCError } from "@trpc/server";
import { createContext } from "../trpc/context.js";
import { appRouter } from "../trpc/router.js";

/**
 * REST facade over the tRPC procedures — a Supabase-style Management API mounted
 * at /api/v1. Each route builds a tRPC caller from the request's auth context and
 * delegates to the existing procedure, so there is exactly one source of business
 * logic. The OpenAPI spec for these routes is served from ./openapi.ts.
 */

/** Map tRPC error codes to HTTP status codes. */
const STATUS: Record<string, number> = {
  PARSE_ERROR: 400,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  METHOD_NOT_SUPPORTED: 405,
  TIMEOUT: 408,
  CONFLICT: 409,
  PRECONDITION_FAILED: 412,
  PAYLOAD_TOO_LARGE: 413,
  UNPROCESSABLE_CONTENT: 422,
  TOO_MANY_REQUESTS: 429,
  CLIENT_CLOSED_REQUEST: 499,
  INTERNAL_SERVER_ERROR: 500,
};

async function caller(req: Request) {
  const ctx = await createContext({ req } as CreateExpressContextOptions);
  return appRouter.createCaller(ctx);
}

/** Run a procedure call and serialise the result / error as JSON. */
async function run(res: Response, work: () => Promise<unknown>): Promise<void> {
  try {
    const data = await work();
    res.json({ data: data ?? null });
  } catch (err) {
    if (err instanceof TRPCError) {
      res.status(STATUS[err.code] ?? 500).json({ error: { code: err.code, message: err.message } });
      return;
    }
    const message = err instanceof Error ? err.message : "Internal error";
    res.status(500).json({ error: { code: "INTERNAL_SERVER_ERROR", message } });
  }
}

export const restApiRouter: Router = Router();
const r = restApiRouter;

// ── Auth ──
r.post("/auth/register", (req, res) => run(res, async () => (await caller(req)).auth.register(req.body)));
r.post("/auth/login", (req, res) => run(res, async () => (await caller(req)).auth.login(req.body)));
r.get("/auth/me", (req, res) => run(res, async () => (await caller(req)).auth.me()));

// ── Organizations ──
r.get("/organizations", (req, res) => run(res, async () => (await caller(req)).organization.list()));
r.post("/organizations", (req, res) => run(res, async () => (await caller(req)).organization.create(req.body)));
r.get("/organizations/:id", (req, res) => run(res, async () => (await caller(req)).organization.get({ id: req.params.id })));
r.patch("/organizations/:id", (req, res) =>
  run(res, async () => (await caller(req)).organization.update({ id: req.params.id, ...req.body })),
);
r.delete("/organizations/:id", (req, res) => run(res, async () => (await caller(req)).organization.delete({ id: req.params.id })));

// ── Projects ──
r.get("/projects", (req, res) => run(res, async () => (await caller(req)).project.list()));
r.post("/projects", (req, res) => run(res, async () => (await caller(req)).project.create(req.body)));
r.get("/projects/:id", (req, res) => run(res, async () => (await caller(req)).project.get({ id: req.params.id })));
r.patch("/projects/:id", (req, res) =>
  run(res, async () => (await caller(req)).project.update({ id: req.params.id, ...req.body })),
);
r.post("/projects/:id/pause", (req, res) => run(res, async () => (await caller(req)).project.pause({ id: req.params.id })));
r.post("/projects/:id/resume", (req, res) => run(res, async () => (await caller(req)).project.resume({ id: req.params.id })));
r.post("/projects/:id/wake", (req, res) => run(res, async () => (await caller(req)).project.wake({ id: req.params.id })));
r.delete("/projects/:id", (req, res) => run(res, async () => (await caller(req)).project.delete({ id: req.params.id })));
r.get("/projects/:id/connection", (req, res) =>
  run(res, async () => (await caller(req)).project.connectionInfo({ id: req.params.id })),
);

// ── Backups ──
r.get("/projects/:id/backups", (req, res) =>
  run(res, async () => (await caller(req)).backup.list({ projectId: req.params.id })),
);
r.post("/projects/:id/backups", (req, res) =>
  run(res, async () => (await caller(req)).backup.createManual({ projectId: req.params.id })),
);
r.post("/backups/:backupId/restore", (req, res) =>
  run(res, async () => (await caller(req)).backup.restore({ backupId: req.params.backupId })),
);

// ── Domains ──
r.get("/projects/:id/domains", (req, res) =>
  run(res, async () => (await caller(req)).domain.list({ projectId: req.params.id })),
);
r.post("/projects/:id/domains", (req, res) =>
  run(res, async () => (await caller(req)).domain.add({ projectId: req.params.id, hostname: req.body?.hostname })),
);
r.post("/domains/:id/verify", (req, res) =>
  run(res, async () => (await caller(req)).domain.checkVerification({ id: req.params.id })),
);
r.delete("/domains/:id", (req, res) => run(res, async () => (await caller(req)).domain.remove({ id: req.params.id })));

// ── Metrics ──
r.get("/projects/:id/metrics/latest", (req, res) =>
  run(res, async () => (await caller(req)).metrics.latest({ projectId: req.params.id })),
);
r.get("/projects/:id/metrics", (req, res) =>
  run(res, async () => {
    const raw = req.query.sinceMinutes;
    const sinceMinutes = raw !== undefined ? Number(raw) : undefined;
    return (await caller(req)).metrics.range({ projectId: req.params.id, ...(sinceMinutes ? { sinceMinutes } : {}) });
  }),
);

// ── Branches ──
r.get("/projects/:id/branches", (req, res) =>
  run(res, async () => (await caller(req)).branch.list({ projectId: req.params.id })),
);
r.post("/projects/:id/branches", (req, res) =>
  run(res, async () => (await caller(req)).branch.create({ projectId: req.params.id, branchName: req.body?.branchName })),
);
r.post("/branches/:branchProjectId/merge", (req, res) =>
  run(res, async () => (await caller(req)).branch.merge({ branchProjectId: req.params.branchProjectId })),
);
r.delete("/branches/:branchProjectId", (req, res) =>
  run(res, async () => (await caller(req)).branch.delete({ branchProjectId: req.params.branchProjectId })),
);

// ── Nodes ──
r.get("/nodes", (req, res) => run(res, async () => (await caller(req)).node.list()));
r.get("/nodes/:id", (req, res) => run(res, async () => (await caller(req)).node.get({ id: req.params.id })));
