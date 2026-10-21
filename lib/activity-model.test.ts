import { describe, expect, it } from "vitest";
import type { AppNotification, LessonRequest } from "../components/features/app/types";
import { getActivityAttentionCount, getActivityNotifications } from "../components/features/activity/activity-model";

const notification = (id: string, type: string, read = false, extra: Partial<AppNotification> = {}) => ({ id, type, read, ...extra }) as AppNotification;

describe("activity model", () => {
  it("keeps pending request notifications as shortcuts and hides resolved duplicates", () => {
    const notifications = [
      notification("pending-request", "new_request", false, { requestStatus: "pending" }),
      notification("resolved-request", "new_request", false, { requestStatus: "approved" }),
      notification("message", "new_message"),
    ];

    expect(getActivityNotifications(notifications).map((item) => item.id)).toEqual(["pending-request", "message"]);
  });

  it("counts pending requests and unread non-request notifications once", () => {
    const requests = [{ id: "request" }] as LessonRequest[];
    const notifications = [
      notification("request-copy", "new_request"),
      notification("unread", "new_message"),
      notification("read", "lesson_updated", true),
    ];

    expect(getActivityAttentionCount(requests, notifications)).toBe(2);
  });
});
