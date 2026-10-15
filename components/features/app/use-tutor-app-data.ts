"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useTutorAppActions } from "@/components/features/app/use-tutor-app-actions";
import type {
  AppData,
  AppNotification,
  AvailabilityWindow,
  AvailableSlot,
  BalanceEntry,
  CurrentUser,
  HistoryEvent,
  Lesson,
  LessonRequest,
  RecurringSlot,
  Student,
  TutorProfile,
} from "@/components/features/app/types";
import { readAppData } from "@/lib/app-data-client";
import { preferenceKey, readPreference, writePreference } from "@/lib/client-preferences";
import { syncDelayForVisibility } from "@/lib/incremental-sync";

type TutorAppDataOptions = {
  role: CurrentUser["role"];
  user?: CurrentUser;
  preferenceScope: string;
};

export function useTutorAppData({ role, user, preferenceScope }: TutorAppDataOptions) {
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [recurringSlots, setRecurringSlots] = useState<RecurringSlot[]>([]);
  const [requests, setRequests] = useState<LessonRequest[]>([]);
  const [balanceEntries, setBalanceEntries] = useState<BalanceEntry[]>([]);
  const [historyEvents, setHistoryEvents] = useState<HistoryEvent[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [availabilityWindows, setAvailabilityWindows] = useState<AvailabilityWindow[]>([]);
  const [availableSlots, setAvailableSlots] = useState<AvailableSlot[]>([]);
  const [profile, setProfile] = useState<TutorProfile>({
    name: user?.name ?? "Преподаватель",
    professionalTitle: "Репетитор",
    email: user?.email ?? "",
    avatarColor: "indigo",
  });
  const [teacherName, setTeacherName] = useState(user?.name ?? "Преподаватель");
  const [selectedStudent, setSelectedStudent] = useState("101");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [showPastLessons, setShowPastLessons] = useState(false);
  const [pastLessonsLoading, setPastLessonsLoading] = useState(false);
  const syncCursorRef = useRef(0);
  const syncInFlightRef = useRef(false);
  const requestIdsRef = useRef(new Set<string>());
  const notificationIdsRef = useRef(new Set<string>());

  const applyData = useCallback((data: AppData) => {
    if (data.lessons) setLessons(data.lessons);
    if (data.students) {
      setStudents(data.students);
      setSelectedStudent((current) => data.students?.some((student) => student.id === current) ? current : (data.students?.[0]?.id ?? current));
    }
    if (data.recurringSlots) setRecurringSlots(data.recurringSlots);
    if (data.requests) {
      setRequests(data.requests);
      requestIdsRef.current = new Set(data.requests.map((request) => request.id));
    }
    if (data.balanceEntries) setBalanceEntries(data.balanceEntries);
    if (data.historyEvents) setHistoryEvents(data.historyEvents);
    if (data.notifications) {
      setNotifications(data.notifications);
      notificationIdsRef.current = new Set(data.notifications.map((notification) => notification.id));
    }
    if (data.availabilityWindows) setAvailabilityWindows(data.availabilityWindows);
    if (data.availableSlots) setAvailableSlots(data.availableSlots);
    if (data.teacherName) setTeacherName(data.teacherName);
    if (data.profile) setProfile(data.profile);
    if (typeof data.syncCursor === "number") syncCursorRef.current = data.syncCursor;
  }, []);

  const reload = useCallback(async () => {
    const data = await readAppData(showPastLessons || role === "student");
    applyData(data);
    setLoadError(false);
    setLoading(false);
  }, [applyData, role, showPastLessons]);

  const retry = useCallback(async () => {
    setLoading(true);
    try {
      await reload();
    } catch {
      setLoadError(true);
      setLoading(false);
    }
  }, [reload]);

  const changePastLessonsVisibility = async (show: boolean) => {
    if (!show) {
      setShowPastLessons(false);
      writePreference(preferenceKey(preferenceScope, "show-past-lessons"), "false");
      return;
    }
    setPastLessonsLoading(true);
    try {
      const data = await readAppData(true);
      applyData(data);
      setShowPastLessons(true);
      writePreference(preferenceKey(preferenceScope, "show-past-lessons"), "true");
    } catch {
      toast.error("Не удалось загрузить прошедшие уроки");
    } finally {
      setPastLessonsLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    const includePastLessons = role === "student" || readPreference(preferenceKey(preferenceScope, "show-past-lessons")) === "true";
    void readAppData(includePastLessons)
      .then((data) => {
        if (!active) return;
        applyData(data);
        setShowPastLessons(includePastLessons);
        setLoadError(false);
        setLoading(false);
      })
      .catch(() => {
        if (active) {
          setLoadError(true);
          setLoading(false);
        }
      });
    return () => { active = false; };
  }, [applyData, preferenceScope, role]);

  const syncChanges = useCallback(async () => {
    if (syncInFlightRef.current || !navigator.onLine) return;
    syncInFlightRef.current = true;
    try {
      const data = await readAppData(showPastLessons || role === "student", syncCursorRef.current);
      const newRequest = data.requests?.find((request) => !requestIdsRef.current.has(request.id));
      const newNotification = data.notifications?.find((notification) => !notificationIdsRef.current.has(notification.id) && !notification.read);
      applyData(data);
      if (newRequest && role !== "student") toast.info(`Новый запрос: ${newRequest.name}`);
      else if (newNotification) toast.info(newNotification.title);
    } catch {
      // Фоновая синхронизация повторится по расписанию или при возвращении на вкладку.
    } finally {
      syncInFlightRef.current = false;
    }
  }, [applyData, role, showPastLessons]);

  useEffect(() => {
    if (loading) return;
    let active = true;
    let timer: number | undefined;
    const schedule = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(async () => {
        await syncChanges();
        if (active) schedule();
      }, syncDelayForVisibility(document.visibilityState === "visible"));
    };
    const syncNow = () => { if (document.visibilityState === "visible") void syncChanges(); };
    const syncAndReschedule = () => { syncNow(); schedule(); };
    schedule();
    window.addEventListener("focus", syncAndReschedule);
    window.addEventListener("online", syncAndReschedule);
    document.addEventListener("visibilitychange", syncAndReschedule);
    return () => {
      active = false;
      if (timer !== undefined) window.clearTimeout(timer);
      window.removeEventListener("focus", syncAndReschedule);
      window.removeEventListener("online", syncAndReschedule);
      document.removeEventListener("visibilitychange", syncAndReschedule);
    };
  }, [loading, syncChanges]);

  const actions = useTutorAppActions({ reload, setProfile, setTeacherName });

  return {
    lessons,
    students,
    recurringSlots,
    requests,
    balanceEntries,
    historyEvents,
    notifications,
    availabilityWindows,
    availableSlots,
    profile,
    teacherName,
    selectedStudent,
    setSelectedStudent,
    loading,
    loadError,
    showPastLessons,
    pastLessonsLoading,
    reload,
    retry,
    changePastLessonsVisibility,
    ...actions,
  };
}
