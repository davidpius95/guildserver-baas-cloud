import bcrypt from "bcryptjs";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { db, eq, members, organizations, users } from "@guildserver/baas-db";
import { signSession, slugify } from "../lib/auth.js";
import { protectedProcedure, publicProcedure, router } from "../trpc/trpc.js";

export const authRouter = router({
  register: publicProcedure
    .input(
      z.object({
        email: z.string().email(),
        password: z.string().min(8),
        name: z.string().min(1).optional(),
        orgName: z.string().min(1).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const existing = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, input.email))
        .limit(1);
      if (existing.length > 0) {
        throw new TRPCError({ code: "CONFLICT", message: "Email already registered" });
      }

      const passwordHash = await bcrypt.hash(input.password, 10);
      const result = await db.transaction(async (tx) => {
        const [user] = await tx
          .insert(users)
          .values({ email: input.email, name: input.name, password: passwordHash })
          .returning({ id: users.id });

        const [org] = await tx
          .insert(organizations)
          .values({
            name: input.orgName ?? `${input.name ?? input.email.split("@")[0]}'s Org`,
            slug: slugify(input.orgName ?? input.email.split("@")[0]),
            ownerId: user.id,
          })
          .returning({ id: organizations.id });

        await tx.insert(members).values({
          userId: user.id,
          organizationId: org.id,
          role: "owner",
        });

        return { userId: user.id, organizationId: org.id };
      });

      const token = await signSession(result.userId, result.organizationId);
      return { token, ...result };
    }),

  login: publicProcedure
    .input(z.object({ email: z.string().email(), password: z.string() }))
    .mutation(async ({ input }) => {
      const rows = await db
        .select()
        .from(users)
        .where(eq(users.email, input.email))
        .limit(1);
      const user = rows[0];
      if (!user || !(await bcrypt.compare(input.password, user.password))) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid credentials" });
      }
      const membership = await db
        .select({ organizationId: members.organizationId })
        .from(members)
        .where(eq(members.userId, user.id))
        .limit(1);
      const organizationId = membership[0]?.organizationId ?? null;
      const token = await signSession(user.id, organizationId);
      return { token, userId: user.id, organizationId };
    }),

  me: protectedProcedure.query(async ({ ctx }) => {
    const rows = await db
      .select({ id: users.id, email: users.email, name: users.name, role: users.role })
      .from(users)
      .where(eq(users.id, ctx.userId!))
      .limit(1);
    const memberships = await db
      .select({ organizationId: members.organizationId, role: members.role })
      .from(members)
      .where(eq(members.userId, ctx.userId!));
    return { user: rows[0] ?? null, organizations: memberships, activeOrg: ctx.organizationId };
  }),
});
