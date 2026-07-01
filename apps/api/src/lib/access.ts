import { TRPCError } from "@trpc/server";
import { and, baasProjects, db, eq, members } from "@guildserver/baas-db";

/** Throw unless the user is a member of the organization. */
export async function assertOrgMember(userId: string, organizationId: string): Promise<void> {
  const rows = await db
    .select({ id: members.id })
    .from(members)
    .where(and(eq(members.userId, userId), eq(members.organizationId, organizationId)))
    .limit(1);
  if (rows.length === 0) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Not a member of this organization" });
  }
}

/** Load a project and assert the user's active org owns it. Returns the project. */
export async function loadOwnedProject(userId: string, organizationId: string | null, projectId: string) {
  const rows = await db.select().from(baasProjects).where(eq(baasProjects.id, projectId)).limit(1);
  const project = rows[0];
  if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
  await assertOrgMember(userId, project.organizationId);
  return project;
}
