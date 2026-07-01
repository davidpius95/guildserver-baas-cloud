import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { baasProjects, db, eq } from "@guildserver/baas-db";
import { loadOwnedProject } from "../lib/access.js";
import { slugify } from "../lib/auth.js";
import { enqueueProvision } from "../queues.js";
import { protectedProcedure, router } from "../trpc/trpc.js";

export const branchRouter = router({
  list: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await loadOwnedProject(ctx.userId!, ctx.organizationId, input.projectId);
      return db
        .select({
          id: baasProjects.id,
          name: baasProjects.name,
          slug: baasProjects.slug,
          status: baasProjects.status,
          branchName: baasProjects.branchName,
          createdAt: baasProjects.createdAt,
        })
        .from(baasProjects)
        .where(eq(baasProjects.parentProjectId, input.projectId));
    }),

  create: protectedProcedure
    .input(z.object({ projectId: z.string().uuid(), branchName: z.string().min(1).max(60) }))
    .mutation(async ({ ctx, input }) => {
      const parent = await loadOwnedProject(ctx.userId!, ctx.organizationId, input.projectId);
      if (parent.status !== "active") {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Parent must be active" });
      }
      // Create the branch project row inheriting the parent's tier + org.
      const [branch] = await db
        .insert(baasProjects)
        .values({
          name: `${parent.name} (${input.branchName})`,
          slug: slugify(`${parent.slug}-branch-${input.branchName}`),
          organizationId: parent.organizationId,
          parentProjectId: parent.id,
          branchName: input.branchName,
          branchType: "preview",
          status: "provisioning",
          vcpuLimit: parent.vcpuLimit,
          ramMbLimit: parent.ramMbLimit,
          storageGbLimit: parent.storageGbLimit,
          analyticsEnabled: parent.analyticsEnabled,
        })
        .returning({ id: baasProjects.id });

      await enqueueProvision({ type: "branch-create", projectId: branch.id, branchName: input.branchName });
      return branch;
    }),

  merge: protectedProcedure
    .input(z.object({ branchProjectId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const branch = await loadOwnedProject(ctx.userId!, ctx.organizationId, input.branchProjectId);
      if (!branch.parentProjectId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Not a branch" });
      }
      await enqueueProvision({ type: "branch-merge", projectId: input.branchProjectId });
      return { ok: true };
    }),

  delete: protectedProcedure
    .input(z.object({ branchProjectId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const branch = await loadOwnedProject(ctx.userId!, ctx.organizationId, input.branchProjectId);
      if (!branch.parentProjectId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Not a branch" });
      }
      await enqueueProvision({ type: "branch-delete", projectId: input.branchProjectId });
      return { ok: true };
    }),
});
