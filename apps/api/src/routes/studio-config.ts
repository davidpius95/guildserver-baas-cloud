import type { Request, Response } from "express";
import { baasProjects, db, eq } from "@guildserver/baas-db";
import { decryptNullable } from "@guildserver/baas-scheduler";

/**
 * Per-project Studio/connection info. Intended for the dashboard's Studio iframe.
 * NOTE: returns decrypted keys — the API mounts this behind auth in index.ts.
 */
export async function studioConfigHandler(req: Request, res: Response): Promise<void> {
  const { projectId } = req.params;
  const rows = await db.select().from(baasProjects).where(eq(baasProjects.id, projectId)).limit(1);
  const p = rows[0];
  if (!p) {
    res.status(404).json({ error: "not found" });
    return;
  }
  res.json({
    slug: p.slug,
    status: p.status,
    apiUrl: p.apiUrl,
    studioUrl: p.studioUrl,
    anonKey: decryptNullable(p.anonKey),
    serviceRoleKey: decryptNullable(p.serviceRoleKey),
  });
}
