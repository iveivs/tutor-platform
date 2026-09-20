import { afterEach, describe, expect, it, vi } from "vitest";
import { requestPasswordRecovery, updatePassword } from "./supabase-password";

const config = { url: "https://example.supabase.co", publishableKey: "public" };

afterEach(() => vi.unstubAllGlobals());

describe("Supabase password recovery", () => {
  it("requests a recovery email with the application redirect", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(requestPasswordRecovery(config, "student@example.com", "https://app.example/")).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.supabase.co/auth/v1/recover?redirect_to=https%3A%2F%2Fapp.example%2F",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ email: "student@example.com" }) }),
    );
  });

  it("updates a password only through the supplied bearer token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(updatePassword(config, "recovery-token", "new-password")).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.supabase.co/auth/v1/user",
      expect.objectContaining({
        method: "PUT",
        headers: expect.objectContaining({ authorization: "Bearer recovery-token", apikey: "public" }),
        body: JSON.stringify({ password: "new-password" }),
      }),
    );
  });

  it("reports an expired or invalid token without exposing the upstream response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 401 })));
    await expect(updatePassword(config, "expired-token", "new-password")).resolves.toBe(false);
  });
});
