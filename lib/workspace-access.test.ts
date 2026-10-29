import { describe, expect, it } from "vitest";
import { accessReminderStage, accessReminderText } from "../scripts/access-reminders.mjs";
import { accessModeAt, daysLeft, endOfMoscowDate, endOfMoscowDay, extendAccess, rejectReadOnlyWrite, trialEndsAt } from "./workspace-access";

const at = (iso: string) => Date.parse(iso);

describe("workspace access", () => {
  it("is read-only only after the end date has passed", () => {
    expect(accessModeAt(null)).toBe("full");
    expect(accessModeAt(at("2026-11-10T20:59:59.999Z"), at("2026-11-10T20:00:00Z"))).toBe("full");
    expect(accessModeAt(at("2026-11-10T20:59:59.999Z"), at("2026-11-10T21:00:00Z"))).toBe("read_only");
  });

  it("ends access at the end of the Moscow day", () => {
    expect(endOfMoscowDate("2026-11-10").toISOString()).toBe("2026-11-10T20:59:59.999Z");
    // 23:30 Moscow on 10 November is already 20:30 UTC of the same day.
    expect(endOfMoscowDay(at("2026-11-10T20:30:00Z")).toISOString()).toBe("2026-11-10T20:59:59.999Z");
    expect(trialEndsAt(at("2026-10-29T09:00:00Z")).toISOString()).toBe("2026-11-28T20:59:59.999Z");
  });

  it("continues an unfinished period and restarts an ended one", () => {
    const now = at("2026-11-07T09:00:00Z");
    expect(extendAccess(at("2026-11-10T20:59:59.999Z"), 1, now).until.toISOString()).toBe("2026-12-10T20:59:59.999Z");
    expect(extendAccess(at("2026-11-01T20:59:59.999Z"), 1, now).until.toISOString()).toBe("2026-12-07T20:59:59.999Z");
    expect(extendAccess(null, 3, now).until.toISOString()).toBe("2027-02-07T20:59:59.999Z");
    // 31 January + 1 month is the last day of February.
    expect(extendAccess(at("2027-01-31T20:59:59.999Z"), 1, at("2027-01-20T09:00:00Z")).until.toISOString()).toBe("2027-02-28T20:59:59.999Z");
  });

  it("counts days left by Moscow calendar dates", () => {
    const end = at("2026-11-10T20:59:59.999Z");
    expect(daysLeft(end, at("2026-11-10T08:00:00Z"))).toBe(0);
    expect(daysLeft(end, at("2026-11-07T22:00:00Z"))).toBe(2);
    expect(daysLeft(end, at("2026-11-03T09:00:00Z"))).toBe(7);
  });

  it("rejects only changing requests of a read-only workspace", () => {
    const post = new Request("http://localhost/api/app-data", { method: "POST" });
    const get = new Request("http://localhost/api/app-data");
    expect(rejectReadOnlyWrite(get, { accessMode: "read_only" })).toBeNull();
    expect(rejectReadOnlyWrite(post, { accessMode: "full" })).toBeNull();
    expect(rejectReadOnlyWrite(post, { accessMode: "read_only" })?.status).toBe(403);
  });
});

describe("access reminders", () => {
  it("sends 7, 3 and 1 day before the end and once after it", () => {
    expect(accessReminderStage(9, false)).toBeNull();
    expect(accessReminderStage(7, false)).toBe(7);
    expect(accessReminderStage(5, false)).toBe(7);
    expect(accessReminderStage(2, false)).toBe(3);
    expect(accessReminderStage(0, false)).toBe(1);
    expect(accessReminderStage(-1, true)).toBe(0);
  });

  it("words the reminder for a trial and for an ended access", () => {
    expect(accessReminderText({ stage: 3, daysLeft: 3, accessGrant: "trial", endLabel: "10.11.2026" })).toEqual({
      title: "Пробный период заканчивается",
      body: "Осталось 3 дня: доступ до 10.11.2026 включительно. Продлить можно в Настройках → Подписка.",
    });
    expect(accessReminderText({ stage: 1, daysLeft: 1, accessGrant: "paid", endLabel: "10.11.2026" }).body).toMatch(/^Остался 1 день/);
    expect(accessReminderText({ stage: 0, daysLeft: -1, accessGrant: "paid", endLabel: "10.11.2026" }).title).toBe("Кабинет в режиме просмотра");
  });
});
