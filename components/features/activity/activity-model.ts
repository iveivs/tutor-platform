import type { AppNotification, LessonRequest } from "@/components/features/app/types";

export function getActivityNotifications(notifications: AppNotification[]) {
  return notifications.filter(
    (notification) => notification.type !== "new_request" || notification.requestStatus === "pending",
  );
}

export function getActivityAttentionCount(
  requests: LessonRequest[],
  notifications: AppNotification[],
) {
  const unreadNotifications = notifications.filter(
    (notification) => !notification.read && notification.type !== "new_request",
  ).length;

  return requests.length + unreadNotifications;
}
