import type { AppNotification, LessonRequest } from "@/components/features/app/types";

export function getActivityNotifications(notifications: AppNotification[]) {
  return notifications;
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
