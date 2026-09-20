import { afterEach, describe, expect, it, vi } from "vitest";
import { createIdentity, signInExistingIdentity } from "./supabase-identity";

const config = { url: "https://example.supabase.co", publishableKey: "public", secretKey: "secret" };

afterEach(() => vi.unstubAllGlobals());

describe("Supabase invitation identities", () => {
  it("recognizes an existing account after password verification", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ user: { id: "auth-user", email: "student@example.com" } })));

    await expect(signInExistingIdentity(config, "student@example.com", "existing-password")).resolves.toEqual({ id: "auth-user", email: "student@example.com" });
  });

  it("does not accept an invalid existing password", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "invalid_credentials" }, { status: 400 })));

    await expect(signInExistingIdentity(config, "student@example.com", "wrong-password")).resolves.toBeNull();
  });

  it("recognizes the duplicate-user response from the admin API", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ code: "email_exists" }, { status: 422 })));

    await expect(createIdentity(config, "student@example.com", "new-password", "Student")).resolves.toEqual({ ok: false, existing: true });
  });
});
