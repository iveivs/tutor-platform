import { afterEach, describe, expect, it, vi } from "vitest";
import { getD1 } from "@/db/d1";
import { getAuthMember, getPlatformAdmin } from "./auth";

vi.mock("@/db/d1", () => ({ getD1: vi.fn() }));

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function authenticatedRequest() {
  vi.stubEnv("SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "public");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ id: "auth-user", email: "teacher@example.com" })));
  return new Request("https://app.example.com/api/auth/session", { headers: { cookie: "tutor_access=access-token" } });
}

describe("workspace and platform authorization", () => {
  it("keeps workspace access fail-closed in the membership query", async () => {
    const queries: string[] = [];
    const run = vi.fn().mockResolvedValue({ success: true });
    vi.mocked(getD1).mockReturnValue({
      prepare(query: string) {
        queries.push(query);
        return query.startsWith("UPDATE workspaces")
          ? { bind: () => ({ run }) }
          : { bind: () => ({ first: vi.fn().mockResolvedValue({ user_id: "user", member_id: "member", workspace_id: "workspace", role: "owner", display_name: "Teacher", email: "teacher@example.com", is_platform_admin: 0 }) }) };
      },
    } as unknown as D1Database);

    await expect(getAuthMember(authenticatedRequest())).resolves.toMatchObject({ workspaceId: "workspace", role: "owner" });
    expect(queries[0]).toContain("w.access_status = 'active'");
    expect(run).toHaveBeenCalledOnce();
  });

  it("authorizes a platform admin without granting workspace membership", async () => {
    const queries: string[] = [];
    vi.mocked(getD1).mockReturnValue({
      prepare(query: string) {
        queries.push(query);
        return { bind: () => ({ first: vi.fn().mockResolvedValue({ id: "admin", full_name: "Admin", email: "admin@example.com" }) }) };
      },
    } as unknown as D1Database);

    await expect(getPlatformAdmin(authenticatedRequest())).resolves.toEqual({ userId: "admin", name: "Admin", email: "admin@example.com" });
    expect(queries[0]).toContain("is_platform_admin = 1");
    expect(queries[0]).not.toContain("JOIN members");
  });
});
