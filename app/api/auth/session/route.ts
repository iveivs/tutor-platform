import { getAuthIdentity, getAuthMember, getPlatformAdmin } from "@/lib/auth";
import { handleNodeSession } from "@/lib/node-auth-endpoints";

export async function GET(request: Request) {
  const nodeResponse = await handleNodeSession(request);
  if (nodeResponse) return nodeResponse;
  const identity = await getAuthIdentity(request);
  if (!identity) return Response.json({ user: null }, { status: 401 });
  const member = await getAuthMember(request, identity);
  if (member) return Response.json({ user: { name: member.name, email: member.email, role: member.role, workspaceId: member.workspaceId, isPlatformAdmin: member.isPlatformAdmin } });
  const admin = await getPlatformAdmin(request, identity);
  if (!admin) return Response.json({ user: null }, { status: 401 });
  return Response.json({ user: { name: admin.name, email: admin.email, role: "platform_admin", isPlatformAdmin: true } });
}
