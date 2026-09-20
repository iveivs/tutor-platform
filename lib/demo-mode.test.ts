import { describe, expect, it } from "vitest";
import { isLocalDemoModeEnabled, isLocalDemoRequest } from "./demo-mode";

describe("local demo mode", () => {
  it("stays disabled unless explicitly enabled", () => {
    expect(isLocalDemoModeEnabled("localhost", undefined)).toBe(false);
  });

  it.each(["localhost:5173", "127.0.0.1:8787", "[::1]:8787"])("allows the local host %s", (host) => {
    expect(isLocalDemoModeEnabled(host, "true")).toBe(true);
  });

  it("rejects a public host even when the flag is enabled", () => {
    expect(isLocalDemoModeEnabled("tutor-platform.veiv.workers.dev", "true")).toBe(false);
  });

  it("rejects requests without an explicit local flag", () => {
    const request = new Request("http://127.0.0.1:8787/api/app-data");
    expect(isLocalDemoRequest(request, "false")).toBe(false);
  });

  it("only accepts loopback request URLs", () => {
    expect(isLocalDemoRequest(new Request("http://127.0.0.1:8787/api/app-data"), "true")).toBe(true);
    expect(isLocalDemoRequest(new Request("https://tutor-platform.veiv.workers.dev/api/app-data"), "true")).toBe(false);
  });
});
