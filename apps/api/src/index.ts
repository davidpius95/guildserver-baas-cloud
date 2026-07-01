import { createExpressMiddleware } from "@trpc/server/adapters/express";
import cors from "cors";
import express from "express";
import { assertEncryptionKey } from "@guildserver/baas-scheduler";
import { assertBootEnv, env } from "./env.js";
import { createContext } from "./trpc/context.js";
import { appRouter } from "./trpc/router.js";
import { studioConfigHandler } from "./routes/studio-config.js";
import { startWorkers } from "./workers.js";
import { startCrons } from "./crons.js";

// ── Fail fast on boot if critical config is missing ──
assertBootEnv();
assertEncryptionKey();

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "baas-api", ts: new Date().toISOString() });
});

// Per-project Studio connection config (used by the dashboard iframe).
app.get("/studio/:projectId/config", (req, res) => {
  studioConfigHandler(req, res).catch((err) => {
    console.error("[studio-config]", err);
    res.status(500).json({ error: "internal error" });
  });
});

app.use(
  "/trpc",
  createExpressMiddleware({
    router: appRouter,
    createContext,
  }),
);

const workers = startWorkers();
const crons = startCrons();

const server = app.listen(env.port, () => {
  console.log(`[baas-api] listening on :${env.port}`);
  console.log(`[baas-api] dashboard: ${env.webUrl}`);
});

async function shutdown(signal: string) {
  console.log(`[baas-api] received ${signal}, shutting down…`);
  crons.stop();
  await workers.close();
  server.close(() => process.exit(0));
  // Force-exit if not closed in time.
  setTimeout(() => process.exit(0), 10_000).unref();
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

export type { AppRouter } from "./trpc/router.js";
