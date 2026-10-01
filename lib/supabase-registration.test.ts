import { afterEach, describe, expect, it, vi } from "vitest";
import { requestTeacherSignup } from "./supabase-registration";

const config = { url: "https://example.supabase.co", publishableKey: "public" };
const input = { email: "teacher@example.com", password: "strong-password", displayName: "Teacher", redirectTo: "https://app.example.com" };

afterEach(() => vi.unstubAllGlobals());

describe("teacher registration in Supabase", () => {
  it("accepts an unconfirmed new identity", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ user: { id: "auth-user", identities: [{ id: "identity" }] }, session: null })));
    await expect(requestTeacherSignup(config, input)).resolves.toEqual({ ok: true, deliverable: true, authSubject: "auth-user" });
  });

  it("does not reveal an existing confirmed account", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ user: { id: "obfuscated", identities: [] }, session: null })));
    await expect(requestTeacherSignup(config, input)).resolves.toEqual({ ok: true, deliverable: false });
  });

  it("fails closed when email confirmation is disabled", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ user: { id: "auth-user" }, access_token: "token" })));
    await expect(requestTeacherSignup(config, input)).resolves.toEqual({ ok: false, reason: "configuration" });
  });
});
