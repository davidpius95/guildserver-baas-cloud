import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { and, db, eq, members, organizations, users } from "@guildserver/baas-db";
import { assertOrgMember } from "../lib/access.js";
import { slugify } from "../lib/auth.js";
import { protectedProcedure, router } from "../trpc/trpc.js";

export const organizationRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return db
      .select({
        id: organizations.id,
        name: organizations.name,
        slug: organizations.slug,
        role: members.role,
      })
      .from(members)
      .innerJoin(organizations, eq(members.organizationId, organizations.id))
      .where(eq(members.userId, ctx.userId!));
  }),

  create: protectedProcedure
    .input(z.object({ name: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      return db.transaction(async (tx) => {
        const [org] = await tx
          .insert(organizations)
          .values({ name: input.name, slug: slugify(input.name), ownerId: ctx.userId! })
          .returning();
        await tx.insert(members).values({
          userId: ctx.userId!,
          organizationId: org.id,
          role: "owner",
        });
        return org;
      });
    }),

  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertOrgMember(ctx.userId!, input.id);
      const rows = await db.select().from(organizations).where(eq(organizations.id, input.id)).limit(1);
      return rows[0] ?? null;
    }),

  update: protectedProcedure
    .input(z.object({ id: z.string().uuid(), name: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await assertOrgMember(ctx.userId!, input.id);
      const [org] = await db
        .update(organizations)
        .set({ name: input.name, updatedAt: new Date() })
        .where(eq(organizations.id, input.id))
        .returning();
      return org;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const rows = await db.select().from(organizations).where(eq(organizations.id, input.id)).limit(1);
      const org = rows[0];
      if (!org) throw new TRPCError({ code: "NOT_FOUND" });
      if (org.ownerId !== ctx.userId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only the owner can delete an org" });
      }
      await db.delete(organizations).where(eq(organizations.id, input.id));
      return { ok: true };
    }),

  listMembers: protectedProcedure
    .input(z.object({ organizationId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertOrgMember(ctx.userId!, input.organizationId);
      return db
        .select({
          userId: members.userId,
          email: users.email,
          name: users.name,
          role: members.role,
        })
        .from(members)
        .innerJoin(users, eq(members.userId, users.id))
        .where(eq(members.organizationId, input.organizationId));
    }),

  inviteMember: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().uuid(),
        email: z.string().email(),
        role: z.enum(["admin", "member"]).default("member"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertOrgMember(ctx.userId!, input.organizationId);
      const userRows = await db.select({ id: users.id }).from(users).where(eq(users.email, input.email)).limit(1);
      const user = userRows[0];
      if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "No user with that email" });
      const existing = await db
        .select({ id: members.id })
        .from(members)
        .where(and(eq(members.userId, user.id), eq(members.organizationId, input.organizationId)))
        .limit(1);
      if (existing.length > 0) throw new TRPCError({ code: "CONFLICT", message: "Already a member" });
      await db.insert(members).values({
        userId: user.id,
        organizationId: input.organizationId,
        role: input.role,
      });
      return { ok: true };
    }),

  removeMember: protectedProcedure
    .input(z.object({ organizationId: z.string().uuid(), userId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertOrgMember(ctx.userId!, input.organizationId);
      await db
        .delete(members)
        .where(and(eq(members.userId, input.userId), eq(members.organizationId, input.organizationId)));
      return { ok: true };
    }),
});
