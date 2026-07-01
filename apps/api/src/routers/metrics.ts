import { z } from "zod";
import { and, baasMetrics, db, desc, eq, gte } from "@guildserver/baas-db";
import { loadOwnedProject } from "../lib/access.js";
import { protectedProcedure, router } from "../trpc/trpc.js";

export const metricsRouter = router({
  latest: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await loadOwnedProject(ctx.userId!, ctx.organizationId, input.projectId);
      const rows = await db
        .select()
        .from(baasMetrics)
        .where(eq(baasMetrics.projectId, input.projectId))
        .orderBy(desc(baasMetrics.collectedAt))
        .limit(1);
      return rows[0] ?? null;
    }),

  range: protectedProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        sinceMinutes: z.number().int().positive().max(60 * 24 * 30).default(60),
      }),
    )
    .query(async ({ ctx, input }) => {
      await loadOwnedProject(ctx.userId!, ctx.organizationId, input.projectId);
      const since = new Date(Date.now() - input.sinceMinutes * 60_000);
      return db
        .select()
        .from(baasMetrics)
        .where(and(eq(baasMetrics.projectId, input.projectId), gte(baasMetrics.collectedAt, since)))
        .orderBy(desc(baasMetrics.collectedAt))
        .limit(2000);
    }),
});
