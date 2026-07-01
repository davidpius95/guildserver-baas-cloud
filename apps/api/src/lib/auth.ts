import { SignJWT } from "jose";
import { env } from "../env.js";

function expiresInSeconds(spec: string): number {
  const m = /^(\d+)([smhd])$/.exec(spec.trim());
  if (!m) return 7 * 86400;
  const n = Number(m[1]);
  const unit = m[2];
  return unit === "s" ? n : unit === "m" ? n * 60 : unit === "h" ? n * 3600 : n * 86400;
}

/** Sign a session JWT for a user (optionally scoped to an organization). */
export async function signSession(userId: string, organizationId?: string | null): Promise<string> {
  const secret = new TextEncoder().encode(env.jwtSecret);
  const now = Math.floor(Date.now() / 1000);
  const jwt = new SignJWT({ org: organizationId ?? undefined })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(userId)
    .setIssuedAt(now)
    .setExpirationTime(now + expiresInSeconds(env.jwtExpiresIn));
  return jwt.sign(secret);
}

/** URL-safe slug from an arbitrary name, with a short random suffix for uniqueness. */
export function slugify(name: string, withSuffix = true): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "org";
  if (!withSuffix) return base;
  const suffix = Math.random().toString(36).slice(2, 7);
  return `${base}-${suffix}`;
}
