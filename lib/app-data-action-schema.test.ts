import { describe, expect, it } from "vitest";
import { actionBodySchema } from "./app-data/action-schema";

describe("app data notification actions", () => {
  it("accepts marking every notification as read", () => {
    expect(actionBodySchema.safeParse({ action: "markNotificationsRead" }).success).toBe(true);
  });

  it("accepts marking one owned notification as read", () => {
    expect(actionBodySchema.safeParse({ action: "markNotificationsRead", notificationId: "notification-1" }).success).toBe(true);
  });

  it("rejects an empty notification id", () => {
    expect(actionBodySchema.safeParse({ action: "markNotificationsRead", notificationId: "" }).success).toBe(false);
  });
});
