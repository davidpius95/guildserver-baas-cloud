import { z } from "zod";
import { baasNodes, db, eq } from "@guildserver/baas-db";
import { adminProcedure, protectedProcedure, router } from "../trpc/trpc.js";

export const nodeRouter = router({
  list: protectedProcedure.query(async () => {
    return db
      .select({
        id: baasNodes.id,
        name: baasNodes.name,
        hostname: baasNodes.hostname,
        role: baasNodes.role,
        status: baasNodes.status,
        vcpuTotal: baasNodes.vcpuTotal,
        ramMbTotal: baasNodes.ramMbTotal,
        storageGbTotal: baasNodes.storageGbTotal,
        vcpuUsed: baasNodes.vcpuUsed,
        ramMbUsed: baasNodes.ramMbUsed,
        storageGbUsed: baasNodes.storageGbUsed,
        lastHeartbeat: baasNodes.lastHeartbeat,
      })
      .from(baasNodes);
  }),

  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      const rows = await db.select().from(baasNodes).where(eq(baasNodes.id, input.id)).limit(1);
      return rows[0] ?? null;
    }),

  update: adminProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        status: z.enum(["online", "offline", "maintenance", "error"]).optional(),
        vcpuTotal: z.number().int().optional(),
        ramMbTotal: z.number().int().optional(),
        storageGbTotal: z.number().int().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const { id, ...patch } = input;
      const [node] = await db
        .update(baasNodes)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(baasNodes.id, id))
        .returning();
      return node;
    }),
});
