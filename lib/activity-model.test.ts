import { describe, expect, it } from "vitest";
import type { AppNotification, LessonRequest } from "../components/features/app/types";
import { getActivityAttentionCount, getActivityNotifications } from "../components/features/activity/activity-model";

const notification = (id: string, type: string, read = false) => ({ id, type, read }) as AppNotification;

describe("activity model", () => {
  it("removes request notifications that duplicate the actionable request list", () => {
    const notifications = [
      notification("request", "new_request"),
      notification("message", "new_message"),
    ];

    expect(getActivityNotifications(notifications).map((item) => item.id)).toEqual(["message"]);
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
