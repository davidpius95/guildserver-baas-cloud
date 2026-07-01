import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { baasBackups, db, desc, eq } from "@guildserver/baas-db";
import { loadOwnedProject } from "../lib/access.js";
import { enqueueBackup } from "../queues.js";
import { protectedProcedure, router } from "../trpc/trpc.js";

export const backupRouter = router({
  list: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await loadOwnedProject(ctx.userId!, ctx.organizationId, input.projectId);
      return db
        .select()
        .from(baasBackups)
        .where(eq(baasBackups.projectId, input.projectId))
        .orderBy(desc(baasBackups.createdAt));
    }),

  createManual: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const p = await loadOwnedProject(ctx.userId!, ctx.organizationId, input.projectId);
      if (p.status !== "active") {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: `Project is ${p.status}` });
      }
      await enqueueBackup({ type: "create", projectId: input.projectId, backupType: "manual" });
      return { ok: true };
    }),

  restore: protectedProcedure
    .input(z.object({ backupId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const rows = await db.select().from(baasBackups).where(eq(baasBackups.id, input.backupId)).limit(1);
      const backup = rows[0];
      if (!backup) throw new TRPCError({ code: "NOT_FOUND" });
      await loadOwnedProject(ctx.userId!, ctx.organizationId, backup.projectId);
      await enqueueBackup({ type: "restore", backupId: input.backupId });
      return { ok: true };
    }),
});
