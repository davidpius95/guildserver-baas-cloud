import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { and, baasProjects, db, desc, eq } from "@guildserver/baas-db";
import { decryptNullable } from "@guildserver/baas-scheduler";
import { assertOrgMember, loadOwnedProject } from "../lib/access.js";
import { slugify } from "../lib/auth.js";
import { enqueueProvision } from "../queues.js";
import { protectedProcedure, router } from "../trpc/trpc.js";

// A full 11-service Supabase stack (Postgres + Kong + GoTrue + PostgREST +
// Realtime + Storage + imgproxy + pg-meta + edge-runtime + Studio + Supavisor)
// needs meaningfully more than a single lightweight service — 1GB total OOM-kills
// Kong alone. These floors match Supabase's own self-hosted minimums.
const RESOURCE_TIERS = {
  micro: { vcpu: 1, ramMb: 1536, storageGb: 5 },
  small: { vcpu: 2, ramMb: 2048, storageGb: 10 },
  medium: { vcpu: 3, ramMb: 3072, storageGb: 20 },
  large: { vcpu: 4, ramMb: 4096, storageGb: 40 },
} as const;

export const projectRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    if (!ctx.organizationId) return [];
    return db
      .select({
        id: baasProjects.id,
        name: baasProjects.name,
        slug: baasProjects.slug,
        status: baasProjects.status,
        statusMessage: baasProjects.statusMessage,
        apiUrl: baasProjects.apiUrl,
        parentProjectId: baasProjects.parentProjectId,
        branchName: baasProjects.branchName,
        createdAt: baasProjects.createdAt,
      })
      .from(baasProjects)
      .where(eq(baasProjects.organizationId, ctx.organizationId))
      .orderBy(desc(baasProjects.createdAt));
  }),

  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const p = await loadOwnedProject(ctx.userId!, ctx.organizationId, input.id);
      // Never return raw secret ciphertext.
      const { dbPassword, jwtSecret, anonKey, serviceRoleKey, ...safe } = p;
      return safe;
    }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
        organizationId: z.string().uuid(),
        tier: z.enum(["micro", "small", "medium", "large"]).default("small"),
        idleTimeoutMinutes: z.number().int().positive().optional(),
        analyticsEnabled: z.boolean().default(false),
        scalingMode: z.enum(["manual", "auto"]).default("manual"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertOrgMember(ctx.userId!, input.organizationId);
      const tier = RESOURCE_TIERS[input.tier];
      const [project] = await db
        .insert(baasProjects)
        .values({
          name: input.name,
          slug: slugify(input.name),
          organizationId: input.organizationId,
          status: "provisioning",
          vcpuLimit: String(tier.vcpu),
          ramMbLimit: tier.ramMb,
          storageGbLimit: tier.storageGb,
          idleTimeoutMinutes: input.idleTimeoutMinutes,
          analyticsEnabled: input.analyticsEnabled,
          scalingMode: input.scalingMode,
        })
        .returning({ id: baasProjects.id, slug: baasProjects.slug });

      await enqueueProvision({ type: "provision", projectId: project.id });
      return project;
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).optional(),
        idleTimeoutMinutes: z.number().int().positive().nullable().optional(),
        scalingMode: z.enum(["manual", "auto"]).optional(),
        backupEnabled: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await loadOwnedProject(ctx.userId!, ctx.organizationId, input.id);
      const patch: Record<string, unknown> = { updatedAt: new Date() };
      if (input.name !== undefined) patch.name = input.name;
      if (input.idleTimeoutMinutes !== undefined) patch.idleTimeoutMinutes = input.idleTimeoutMinutes;
      if (input.scalingMode !== undefined) patch.scalingMode = input.scalingMode;
      if (input.backupEnabled !== undefined) patch.backupEnabled = input.backupEnabled;
      const [p] = await db.update(baasProjects).set(patch).where(eq(baasProjects.id, input.id)).returning();
      return p;
    }),

  pause: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await loadOwnedProject(ctx.userId!, ctx.organizationId, input.id);
      await enqueueProvision({ type: "pause", projectId: input.id });
      return { ok: true };
    }),

  resume: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await loadOwnedProject(ctx.userId!, ctx.organizationId, input.id);
      await enqueueProvision({ type: "resume", projectId: input.id });
      return { ok: true };
    }),

  wake: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await loadOwnedProject(ctx.userId!, ctx.organizationId, input.id);
      await enqueueProvision({ type: "resume", projectId: input.id });
      return { ok: true };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await loadOwnedProject(ctx.userId!, ctx.organizationId, input.id);
      await enqueueProvision({ type: "delete", projectId: input.id });
      return { ok: true };
    }),

  connectionInfo: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const p = await loadOwnedProject(ctx.userId!, ctx.organizationId, input.id);
      if (p.status !== "active") {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: `Project is ${p.status}` });
      }
      return {
        apiUrl: p.apiUrl,
        realtimeUrl: p.realtimeUrl,
        storageUrl: p.storageUrl,
        studioUrl: p.studioUrl,
        anonKey: decryptNullable(p.anonKey),
        serviceRoleKey: decryptNullable(p.serviceRoleKey),
        db: {
          host: p.dbHost,
          port: p.dbPort,
          database: p.dbName,
          user: p.dbUser,
          password: decryptNullable(p.dbPassword),
        },
      };
    }),
});
