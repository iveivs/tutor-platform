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

describe("teacher day notes", () => {
  it("accepts saving and deleting a note for an ISO date", () => {
    expect(actionBodySchema.safeParse({ action: "saveTeacherDayNote", date: "2026-10-23", body: "Распечатать ноты" }).success).toBe(true);
    expect(actionBodySchema.safeParse({ action: "saveTeacherDayNote", date: "2026-10-23", body: "" }).success).toBe(true);
  });

  it("rejects oversized notes and malformed dates", () => {
    expect(actionBodySchema.safeParse({ action: "saveTeacherDayNote", date: "23.10.2026", body: "Заметка" }).success).toBe(false);
    expect(actionBodySchema.safeParse({ action: "saveTeacherDayNote", date: "2026-10-23", body: "x".repeat(1001) }).success).toBe(false);
  });
});
