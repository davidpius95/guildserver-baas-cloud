import { randomBytes } from "node:crypto";
import { SignJWT } from "jose";

export interface ProjectSecrets {
  jwtSecret: string;
  dbPassword: string;
  anonKey: string;
  serviceRoleKey: string;
}

/** Far-future expiry Supabase uses for anon/service keys (year 2099). */
const FAR_FUTURE = Math.floor(new Date("2099-01-01T00:00:00Z").getTime() / 1000);
const ISSUED_AT = Math.floor(Date.now() / 1000);

async function signSupabaseKey(role: "anon" | "service_role", jwtSecret: string): Promise<string> {
  const key = new TextEncoder().encode(jwtSecret);
  return new SignJWT({ role, iss: "supabase" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt(ISSUED_AT)
    .setExpirationTime(FAR_FUTURE)
    .sign(key);
}

/**
 * Generate a full set of per-tenant secrets. The returned values are PLAINTEXT;
 * the caller is responsible for encrypting them (via crypto.ts) before persisting.
 */
export async function generateProjectSecrets(): Promise<ProjectSecrets> {
  const jwtSecret = randomBytes(40).toString("hex");
  const dbPassword = randomBytes(16).toString("hex");
  const [anonKey, serviceRoleKey] = await Promise.all([
    signSupabaseKey("anon", jwtSecret),
    signSupabaseKey("service_role", jwtSecret),
  ]);
  return { jwtSecret, dbPassword, anonKey, serviceRoleKey };
}
