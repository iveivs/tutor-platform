import { readAdminWorkspaces } from "@/lib/admin-workspaces/read-handler";
import { updateAdminWorkspaces } from "@/lib/admin-workspaces/write-handler";

export const GET = readAdminWorkspaces;
export const POST = updateAdminWorkspaces;
