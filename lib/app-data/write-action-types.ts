import { getD1 } from "@/db/d1";
import type { ActionBody } from "@/lib/app-data/action-schema";
import type { AuthMember } from "@/lib/auth";

export type WriteActionContext = {
  request: Request;
  db: ReturnType<typeof getD1>;
  body: ActionBody;
  auth: Omit<AuthMember, "isPlatformAdmin">;
  id: string;
};
