import { getAuthMember } from "@/lib/auth";

export async function GET(request: Request) {
  const member = await getAuthMember(request);
  if (!member) return Response.json({ user: null }, { status: 401 });
  return Response.json({ user: { name: member.name, email: member.email, role: member.role, workspaceId: member.workspaceId } });
}
