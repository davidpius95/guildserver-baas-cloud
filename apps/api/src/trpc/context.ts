import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import { jwtVerify } from "jose";
import { and, db, eq, members, users } from "@guildserver/baas-db";
import { env } from "../env.js";

export interface Context {
  userId: string | null;
  organizationId: string | null;
  isAuthenticated: boolean;
  isAdmin: boolean;
}

export async function createContext({ req }: CreateExpressContextOptions): Promise<Context> {
  const anon: Context = {
    userId: null,
    organizationId: null,
    isAuthenticated: false,
    isAdmin: false,
  };

  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return anon;
  const token = auth.slice("Bearer ".length);

  try {
    const secret = new TextEncoder().encode(env.jwtSecret);
    const { payload } = await jwtVerify(token, secret);
    const userId = payload.sub;
    if (!userId || typeof userId !== "string") return anon;

    const userRows = await db
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const user = userRows[0];
    if (!user) return anon;

    // Prefer the organization from the token; fall back to first membership.
    let organizationId: string | null =
      typeof payload.org === "string" ? payload.org : null;
    if (organizationId) {
      const membership = await db
        .select({ id: members.id })
        .from(members)
        .where(and(eq(members.userId, userId), eq(members.organizationId, organizationId)))
        .limit(1);
      if (membership.length === 0) organizationId = null;
    }
    if (!organizationId) {
      const first = await db
        .select({ organizationId: members.organizationId })
        .from(members)
        .where(eq(members.userId, userId))
        .limit(1);
      organizationId = first[0]?.organizationId ?? null;
    }

    return {
      userId,
      organizationId,
      isAuthenticated: true,
      isAdmin: user.role === "admin",
    };
  } catch {
    return anon;
  }
}
