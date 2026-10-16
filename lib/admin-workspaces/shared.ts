import { z } from "zod";
import { getAuthIdentity, getAuthMember, getPlatformAdmin } from "@/lib/auth";

export const adminActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("createTeacherInvite"), name: z.string().trim().min(2).max(80), email: z.string().trim().email().max(254), professionalTitle: z.string().trim().max(50), accessGrant: z.literal("complimentary") }).strict(),
  z.object({ action: z.literal("setWorkspaceAccess"), workspaceId: z.string().min(1).max(128), accessStatus: z.enum(["active", "blocked"]) }).strict(),
  z.object({ action: z.literal("deleteWorkspace"), workspaceId: z.string().min(1).max(128), confirmationEmail: z.string().trim().email().max(254) }).strict(),
  z.object({ action: z.literal("revokeTeacherInvite"), invitationId: z.string().min(1).max(128) }).strict(),
]);

export async function requirePlatformAdmin(request: Request) {
  const identity = await getAuthIdentity(request);
  if (!identity) return Response.json({ error: "Требуется вход" }, { status: 401 });
  const admin = await getPlatformAdmin(request, identity);
  if (!admin) return Response.json({ error: "Недостаточно прав" }, { status: 403 });
  return { admin, member: await getAuthMember(request, identity) };
}
