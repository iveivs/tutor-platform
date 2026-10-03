import { afterEach, describe, expect, it } from "vitest";
import { clearAuthCookies, getAuthConfig, hashPassword, randomToken, sessionCookies, verifyPassword } from "./node-auth";

const originalDatabaseUrl = process.env.DATABASE_URL;
const originalAuthSecret = process.env.AUTH_SECRET;

afterEach(() => {
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
  if (originalAuthSecret === undefined) delete process.env.AUTH_SECRET;
  else process.env.AUTH_SECRET = originalAuthSecret;
});

describe("Node authentication primitives", () => {
  it("hashes passwords with Argon2id", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash.startsWith("$argon2id$")).toBe(true);
    await expect(verifyPassword(hash, "correct horse battery staple")).resolves.toBe(true);
    await expect(verifyPassword(hash, "wrong password")).resolves.toBe(false);
  });

  it("generates opaque 256-bit session tokens", () => {
    const first = randomToken();
    const second = randomToken();
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second).not.toBe(first);
  });

  it("uses secure HttpOnly cookies and clears legacy refresh cookies", () => {
    const request = new Request("https://app.example.com/api/auth/login");
    const cookies = sessionCookies(randomToken(), request);
    expect(cookies[0]).toContain("HttpOnly");
    expect(cookies[0]).toContain("SameSite=Lax");
    expect(cookies[0]).toContain("Secure");
    expect(cookies[1]).toContain("Max-Age=0");
    expect(clearAuthCookies(request)).toHaveLength(2);
  });

  it("fails closed without a sufficiently strong server secret", () => {
    process.env.DATABASE_URL = "postgresql://localhost/tutor";
    process.env.AUTH_SECRET = "too-short";
    expect(getAuthConfig()).toBeNull();
    process.env.AUTH_SECRET = "a".repeat(32);
    expect(getAuthConfig()).not.toBeNull();
  });
});
