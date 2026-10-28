"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useTutorAppActions } from "@/components/features/app/use-tutor-app-actions";
import type { AppData, AppNotification, AvailabilityWindow, AvailableSlot, BalanceEntry, CurrentUser, GroupAbsence, HistoryEvent, Lesson, LessonRequest, NotificationPreferences, RecurringSlot, Student, StudentGroup, TeacherDayNote, TutorProfile } from "@/components/features/app/types";
import { readAppData } from "@/lib/app-data-client";
import { preferenceKey, readPreference, writePreference } from "@/lib/client-preferences";
import { syncDelayForVisibility } from "@/lib/incremental-sync";
import { today } from "@/lib/date-time";
import { appFetch } from "@/lib/client-fetch";

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
  const [dayNotes, setDayNotes] = useState<TeacherDayNote[]>([]);
  const [groups, setGroups] = useState<StudentGroup[]>([]);
  const [groupAbsences, setGroupAbsences] = useState<GroupAbsence[]>([]);
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
  const currentDayRef = useRef(today());
  const soundEnabledRef = useRef(true);
  const audioContextRef = useRef<AudioContext | null>(null);

  const playNotificationSound = useCallback(() => {
    const context = audioContextRef.current;
    if (!soundEnabledRef.current || !context || context.state !== "running") return;
    const now = context.currentTime;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.035, now + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.42);
    gain.connect(context.destination);
    for (const [frequency, delay] of [[660, 0], [880, 0.11]] as const) {
      const oscillator = context.createOscillator();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency, now + delay);
      oscillator.connect(gain);
      oscillator.start(now + delay);
      oscillator.stop(now + delay + 0.24);
    }
  }, []);

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
    if (data.dayNotes) setDayNotes(data.dayNotes);
    if (data.groups) setGroups(data.groups);
    if (data.groupAbsences) setGroupAbsences(data.groupAbsences);
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

  useEffect(() => {
    let active = true;
    const enableAudio = () => {
      audioContextRef.current ??= new AudioContext();
      if (audioContextRef.current.state === "suspended") void audioContextRef.current.resume();
    };
    const updatePreferences = (event: Event) => {
      const preferences = (event as CustomEvent<NotificationPreferences>).detail;
      if (preferences) soundEnabledRef.current = preferences.soundEnabled;
    };
    window.addEventListener("pointerdown", enableAudio, { once: true });
    window.addEventListener("keydown", enableAudio, { once: true });
    window.addEventListener("tyuttori:notification-preferences", updatePreferences);
    void appFetch("/api/notification-preferences", { cache: "no-store" })
      .then((response) => response.ok ? response.json() as Promise<NotificationPreferences> : Promise.reject())
      .then((preferences) => { if (active) soundEnabledRef.current = preferences.soundEnabled; })
      .catch(() => undefined);
    return () => {
      active = false;
      window.removeEventListener("pointerdown", enableAudio);
      window.removeEventListener("keydown", enableAudio);
      window.removeEventListener("tyuttori:notification-preferences", updatePreferences);
      void audioContextRef.current?.close();
      audioContextRef.current = null;
    };
  }, []);

  const syncChanges = useCallback(async () => {
    if (syncInFlightRef.current || !navigator.onLine) return;
    syncInFlightRef.current = true;
    try {
      const nextDay = today();
      if (nextDay !== currentDayRef.current) {
        currentDayRef.current = nextDay;
        await reload();
        return;
      }
      const data = await readAppData(showPastLessons || role === "student", syncCursorRef.current);
      const newRequest = data.requests?.find((request) => !requestIdsRef.current.has(request.id));
      const newNotification = data.notifications?.find((notification) => !notificationIdsRef.current.has(notification.id) && !notification.read);
      applyData(data);
      if (newRequest && role !== "student") {
        toast.info(`Новый запрос: ${newRequest.name}`);
        playNotificationSound();
      } else if (newNotification) {
        toast.info(newNotification.title);
        playNotificationSound();
      }
    } catch {
      // Фоновая синхронизация повторится по расписанию или при возвращении на вкладку.
    } finally {
      syncInFlightRef.current = false;
    }
  }, [applyData, playNotificationSound, reload, role, showPastLessons]);

  useEffect(() => {
    if (loading) return;
    const source = new EventSource("/api/realtime");
    source.onmessage = () => {
      window.dispatchEvent(new Event("tyuttori:realtime"));
      void syncChanges();
    };
    return () => source.close();
  }, [loading, syncChanges]);

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

  const actions = useTutorAppActions({ reload, setProfile, setTeacherName, setStudents });

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
    dayNotes,
    groups,
    groupAbsences,
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
