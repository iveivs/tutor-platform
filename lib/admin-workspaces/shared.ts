import { z } from "zod";
import { getAuthIdentity, getAuthMember, getPlatformAdmin } from "@/lib/auth";

export const adminActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("createTeacherInvite"), name: z.string().trim().min(2).max(80), email: z.string().trim().email().max(254), professionalTitle: z.string().trim().max(50), accessGrant: z.enum(["trial", "complimentary"]) }).strict(),
  // Access type and end date; a null date means no time limit. The date is a Moscow calendar day.
  z.object({ action: z.literal("setAccessTerms"), workspaceId: z.string().min(1).max(128), accessGrant: z.enum(["legacy", "complimentary", "trial", "paid"]), accessUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable() }).strict(),
  z.object({ action: z.literal("addSubscriptionPayment"), workspaceId: z.string().min(1).max(128), amountCents: z.number().int().min(0).max(100000000), months: z.number().int().min(1).max(24), paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), method: z.enum(["transfer", "cash", "other"]), receiptRef: z.string().trim().max(100) }).strict(),
  z.object({ action: z.literal("refundSubscriptionPayment"), paymentId: z.string().min(1).max(128) }).strict(),
  z.object({ action: z.literal("setAdminNote"), workspaceId: z.string().min(1).max(128), note: z.string().max(2000) }).strict(),
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
