"use client";

import { useState } from "react";
import { toast } from "sonner";
import type { AppNotification, LessonRequest } from "@/components/features/app/types";
import { saveAppData } from "@/lib/app-data-client";
import { getActivityAttentionCount, getActivityNotifications } from "./activity-model";

export const activityFilters = ["Все", "Отмена", "Перенос", "Новый урок"] as const;
export type ActivityFilter = (typeof activityFilters)[number];

// Shared state and actions of the "Activity" screen, used by both the current and the v2 layout.
export function useActivityActions({ requests, notifications, onResolved, onReadNotifications }: { requests: LessonRequest[]; notifications: AppNotification[]; onResolved: () => Promise<void>; onReadNotifications: (notificationId?: string) => Promise<void> }) {
  const [filter, setFilter] = useState<ActivityFilter>("Все");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [messageStudentId, setMessageStudentId] = useState<string | null>(null);
  const visibleRequests = requests.filter((request) => filter === "Все" || filter === "Отмена" && request.kind === "cancel" || filter === "Перенос" && request.kind === "reschedule" || filter === "Новый урок" && request.kind === "new_lesson");
  const activityNotifications = getActivityNotifications(notifications);

  const resolve = async (id: string, decision: "approved" | "declined") => {
    setPendingId(id);
    try {
      const result = await saveAppData({ action: "resolveRequest", requestId: id, decision });
      await onResolved();
      if (result.expired) toast.info("Запрос уже неактуален и закрыт");
      else toast.success(decision === "approved" ? "Запрос подтверждён" : "Запрос отклонён");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось обработать запрос");
    } finally {
      setPendingId(null);
    }
  };

  const openNotification = (notification: AppNotification) => {
    if (!notification.read) void onReadNotifications(notification.id);
    if (notification.type === "direct_message" && notification.studentId) {
      setMessageStudentId(notification.studentId);
      return;
    }
    if (notification.type === "new_request" && notification.requestId) {
      setFilter("Все");
      window.requestAnimationFrame(() => {
        const requestCard = document.getElementById(`request-${notification.requestId}`);
        requestCard?.scrollIntoView({ behavior: "smooth", block: "center" });
        requestCard?.focus({ preventScroll: true });
      });
    }
  };

  return { filter, setFilter, pendingId, messageStudentId, setMessageStudentId, visibleRequests, activityNotifications, resolve, openNotification, attentionCount: getActivityAttentionCount(requests, notifications) };
}
