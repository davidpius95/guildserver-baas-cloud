import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Load the repo-root .env (two levels up from apps/api/src).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

export const env = {
  port: Number(process.env.BAAS_API_PORT ?? 4001),
  jwtSecret: process.env.JWT_SECRET ?? "",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "7d",
  webUrl: process.env.BAAS_WEB_URL ?? "http://localhost:3001",
  cloudDomain: process.env.BAAS_CLOUD_DOMAIN ?? "cloud.guildserver.io",
  redis: {
    host: process.env.REDIS_HOST ?? "localhost",
    port: Number(process.env.REDIS_PORT ?? 6379),
  },
};

export function assertBootEnv(): void {
  if (!env.jwtSecret || env.jwtSecret.length < 16) {
    throw new Error("JWT_SECRET must be set (>=16 chars)");
  }
  // Fail fast if the encryption key is missing/malformed.
  // (Imported lazily so this module stays dependency-light.)
}
