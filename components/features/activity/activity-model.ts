import type { AppNotification, LessonRequest } from "@/components/features/app/types";

export function getActivityNotifications(notifications: AppNotification[]) {
  return notifications.filter((notification) => notification.type !== "new_request");
}

export function getActivityAttentionCount(
  requests: LessonRequest[],
  notifications: AppNotification[],
) {
  const unreadNotifications = getActivityNotifications(notifications).filter(
    (notification) => !notification.read,
  ).length;

  return requests.length + unreadNotifications;
}
