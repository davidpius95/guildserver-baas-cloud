import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM encryption for tenant secrets at rest.
 * Key is the base64-encoded 32-byte BAAS_ENCRYPTION_KEY.
 * Payload layout (base64): iv(12) ‖ authTag(16) ‖ ciphertext.
 */

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env.BAAS_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error("BAAS_ENCRYPTION_KEY is not set");
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(
      `BAAS_ENCRYPTION_KEY must decode to 32 bytes (got ${key.length}). Generate with: openssl rand -base64 32`,
    );
  }
  cachedKey = key;
  return key;
}

/**
 * Validate the encryption key at startup. Throws if missing/malformed.
 * Call this early in the API boot sequence to fail fast.
 */
export function assertEncryptionKey(): void {
  getKey();
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

export function decryptSecret(payload: string): string {
  const buf = Buffer.from(payload, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}

/** Decrypt a nullable column value (returns null for null/undefined input). */
export function decryptNullable(payload: string | null | undefined): string | null {
  return payload == null ? null : decryptSecret(payload);
}
