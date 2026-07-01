import { z } from "zod";
import { baasCustomHostnames, db, eq } from "@guildserver/baas-db";
import { loadOwnedProject } from "../lib/access.js";
import { protectedProcedure, router } from "../trpc/trpc.js";

/**
 * Custom-domain management. Cloudflare-for-SaaS integration is optional and only
 * active when CF_API_TOKEN/CF_ZONE_ID are configured; without them we still record
 * intent so the dashboard can display and (later) verify domains.
 */
export const domainRouter = router({
  list: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await loadOwnedProject(ctx.userId!, ctx.organizationId, input.projectId);
      return db
        .select()
        .from(baasCustomHostnames)
        .where(eq(baasCustomHostnames.projectId, input.projectId));
    }),

  add: protectedProcedure
    .input(z.object({ projectId: z.string().uuid(), hostname: z.string().min(3) }))
    .mutation(async ({ ctx, input }) => {
      await loadOwnedProject(ctx.userId!, ctx.organizationId, input.projectId);
      const [row] = await db
        .insert(baasCustomHostnames)
        .values({ projectId: input.projectId, hostname: input.hostname, status: "pending" })
        .returning();
      return row;
    }),

  checkVerification: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input }) => {
      // Without CF integration this is a no-op stub that reports current state.
      const rows = await db
        .select()
        .from(baasCustomHostnames)
        .where(eq(baasCustomHostnames.id, input.id))
        .limit(1);
      return rows[0] ?? null;
    }),

  remove: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input }) => {
      await db.delete(baasCustomHostnames).where(eq(baasCustomHostnames.id, input.id));
      return { ok: true };
    }),
});
