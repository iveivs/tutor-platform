"use client";
import { useEffect, useState } from "react";
import { MobileHeader, MobileNav, Sidebar } from "@/components/common/app-navigation";
import { getActivityAttentionCount } from "@/components/features/activity/activity-model";
import { ActivityView } from "@/components/features/activity/activity-view";
import { useScheduleModelContext } from "@/components/features/app/use-schedule-model-context";
import { useTutorAppData } from "@/components/features/app/use-tutor-app-data";
import { TodayView } from "@/components/features/schedule/today-view";
import { CalendarView } from "@/components/features/schedule/calendar-view";
import { LessonMaterialsDialog } from "@/components/features/materials/lesson-materials-dialog";
import { TeacherMaterialsView } from "@/components/features/materials/teacher-materials-view";
import { StudentPortal } from "@/components/features/student-portal/student-portal";
import { SettingsView } from "@/components/features/settings/settings-view";
import { StatsView } from "@/components/features/stats/stats-view";
import { AccessBanner } from "@/components/features/subscription/access-banner";
import { ImportantNewsBanner } from "@/components/features/support/news";
import { OnboardingTour } from "@/components/features/onboarding/onboarding-tour";
import { GroupActionsProvider } from "@/components/features/groups/group-actions";
import { combineGroupSessions } from "@/lib/group-sessions";
import { GroupView } from "@/components/features/groups/groups-view";
import { StudentsView, StudentView } from "@/components/features/students/student-views";
import type { CurrentUser, Lesson, View } from "@/components/features/app/types";
import { BrandIcon } from "@/components/brand-icon";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { useLanguage } from "@/components/language-provider";
import { usePushDevice } from "@/lib/push-client";


// Sections a push notification may open.
function viewFromPath(path: string): View | null {
  const view = new URLSearchParams(path.includes("?") ? path.slice(path.indexOf("?")) : path).get("view");
  return view === "activity" || view === "today" || view === "settings" ? view : null;
}

export default function TutorApp({ role = "owner", user, onLogout }: { role?: "owner" | "teacher" | "student"; user?: CurrentUser; onLogout?: () => void }) {
  const preferenceScope = user?.email || role;
  const [view, setView] = useState<View>(() => viewFromPath(typeof window === "undefined" ? "/" : window.location.search) ?? "today");
  const [materialsLesson, setMaterialsLesson] = useState<Lesson | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const {
    lessons, students, recurringSlots, requests, balanceEntries, historyEvents, notifications,
    availabilityWindows, availableSlots, dayNotes, groups, myGroups, groupAbsences, profile, teacherName, selectedStudent, setSelectedStudent,
    loading, loadError, showPastLessons, pastLessonsLoading, reload, retry, changePastLessonsVisibility,
    addLesson, updateLesson, deleteLesson, stopLessonSeries, updateStudent, convertTrialContact,
    restoreStudent, deleteStudentPermanently, addStudent, createStudentInvite, addPayment, adjustBalance, updateStudentPrices,
    createGroup, updateGroup, setGroupMembers, setGroupSlots, archiveGroup, addGroupSession, cancelGroupSession, rescheduleGroupSession,
    reversePayment, submitStudentRequest, markNotificationsRead, updateProfile, updateAvailability, saveTeacherDayNote,
  } = useTutorAppData({ role, user, preferenceScope });

  useScheduleModelContext({ lessons, students, reload });
  const { language } = useLanguage();
  // A notification click opens "/?view=…"; drop the parameter once it has been applied.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("view")) window.history.replaceState(window.history.state, "", window.location.pathname);
  }, []);
  const badgeCount = loading ? null : role === "student" ? notifications.filter((item) => !item.read).length : getActivityAttentionCount(requests, notifications);
  usePushDevice(badgeCount, language, (path) => {
    const next = viewFromPath(path);
    if (next && role !== "student") setView(next);
  });

  if (loading) return <main className="grid min-h-screen place-items-center bg-background text-foreground"><div className="text-center"><BrandIcon className="mx-auto mb-3 size-12 animate-pulse" /><p className="font-semibold">Загружаю расписание…</p></div></main>;
  if (loadError) return <main className="grid min-h-screen place-items-center bg-background px-4 text-foreground"><div className="card max-w-md p-7 text-center"><h1 className="text-xl font-bold">Данные временно недоступны</h1><p className="mt-2 text-ink-muted">Локальная база не ответила. Попробуйте ещё раз.</p><Button className="mt-5 bg-brand-solid" onClick={() => void retry()}>Повторить</Button></div></main>;
  const activeLessons = lessons.filter((lesson) => !lesson.past);
  // Today and the calendar show a group session as one card; other screens keep one lesson per student.
  const scheduleLessons = combineGroupSessions(lessons, groupAbsences);
  const activeScheduleLessons = scheduleLessons.filter((lesson) => !lesson.past);
  const groupActions = { groups, createGroup, updateGroup, setGroupMembers, setGroupSlots, archiveGroup, addGroupSession, cancelGroupSession, rescheduleGroupSession, cancelMemberLesson: deleteLesson, openGroup: (groupId: string) => { setSelectedGroup(groupId); setView("group"); } };
  const openedGroup = groups.find((group) => group.id === selectedGroup);
  const activeStudents = students.filter((student) => !student.archived);
  const activityCount = getActivityAttentionCount(requests, notifications);
  const portalStudent = students.find((student) => student.id === selectedStudent) ?? students[0];
  if (role === "student") return portalStudent
    ? <><OnboardingTour role="student" /><StudentPortal student={portalStudent} teacherName={teacherName} lessons={lessons} entries={balanceEntries} historyEvents={historyEvents} requests={requests} notifications={notifications} availableSlots={availableSlots} onReadNotifications={markNotificationsRead} onRequest={submitStudentRequest} onMaterials={setMaterialsLesson} onBack={onLogout ?? (() => undefined)} onReload={reload} myGroups={myGroups} /><LessonMaterialsDialog key={materialsLesson?.id ?? "closed"} lesson={materialsLesson} role={role} onOpenChange={(open) => !open && setMaterialsLesson(null)} /></>
    : <main className="grid min-h-screen place-items-center bg-background px-4 text-foreground"><div className="card max-w-md p-7 text-center"><h1 className="text-xl font-bold">Кабинет ученика не найден</h1><p className="mt-2 text-ink-muted">Аккаунт вошёл, но не связан с карточкой ученика. Попросите преподавателя создать новое приглашение.</p><Button className="mt-5" variant="outline" onClick={onLogout}>Выйти</Button></div></main>;

  return (
    <GroupActionsProvider value={groupActions}><main className="min-h-screen bg-background text-foreground">
      <Sidebar view={view} setView={setView} name={profile.name} professionalTitle={profile.professionalTitle} onLogout={onLogout} activityCount={activityCount} />
      <section className="min-h-screen pb-24 lg:ml-[var(--sidebar-width)] lg:pb-0">
        <MobileHeader name={profile.name} professionalTitle={profile.professionalTitle} activityCount={activityCount} onActivity={() => setView("activity")} view={view} />
        <AccessBanner onRenew={() => { setView("settings"); window.scrollTo({ top: 0 }); }} />
        <ImportantNewsBanner />
        {view === "today" && <TodayView lessons={activeScheduleLessons} students={activeStudents} requests={requests} dayNotes={dayNotes} onSaveDayNote={saveTeacherDayNote} onAdd={addLesson} onUpdate={updateLesson} onDelete={deleteLesson} onMaterials={setMaterialsLesson} setView={setView} onOpenStudent={(id) => { setSelectedStudent(id); setView("student"); }} />}
        {view === "calendar" && <CalendarView preferenceScope={preferenceScope} lessons={scheduleLessons} students={students.filter((student) => !student.archived)} dayNotes={dayNotes} onSaveDayNote={saveTeacherDayNote} showPastLessons={showPastLessons} pastLessonsLoading={pastLessonsLoading} onShowPastLessonsChange={changePastLessonsVisibility} onAdd={addLesson} onUpdate={updateLesson} onDelete={deleteLesson} onMaterials={setMaterialsLesson} onConvertTrial={convertTrialContact} onOpenStudent={(id) => { setSelectedStudent(id); setView("student"); }} />}
        {view === "students" && <StudentsView students={students} onAdd={addStudent} onOpen={(id) => { setSelectedStudent(id); setView("student"); }} />}
        {view === "student" && students.length > 0 && <StudentView student={students.find((student) => student.id === selectedStudent) ?? students[0]} lessons={activeLessons} recurringSlots={recurringSlots} balanceEntries={balanceEntries} historyEvents={historyEvents} onAdd={addLesson} onBack={() => setView("students")} onPay={addPayment} onUpdatePrices={updateStudentPrices} onAdjustBalance={adjustBalance} onReversePayment={reversePayment} onCreateInvite={createStudentInvite} onUpdate={updateStudent} onStopSeries={stopLessonSeries} onRestore={restoreStudent} onDeletePermanently={async (studentId) => { const deleted = await deleteStudentPermanently(studentId); if (deleted) setView("students"); return deleted; }} onReload={reload} />}
        {view === "activity" && <ActivityView requests={requests} notifications={notifications} historyEvents={historyEvents} students={students} preferenceScope={preferenceScope} onResolved={reload} onReadNotifications={markNotificationsRead} onReversePayment={reversePayment} />}
        {view === "materials" && <TeacherMaterialsView />}
        {view === "stats" && <StatsView />}
        {view === "group" && openedGroup && <GroupView group={openedGroup} students={students} lessons={activeLessons} onBack={() => setView("students")} onOpenStudent={(id) => { setSelectedStudent(id); setView("student"); }} />}
        {view === "settings" && <SettingsView profile={profile} availabilityWindows={availabilityWindows} onSave={updateProfile} onSaveAvailability={updateAvailability} onLogout={onLogout} isPlatformAdmin={Boolean(user?.isPlatformAdmin)} />}
      </section>
      <MobileNav view={view} setView={setView} />
      <LessonMaterialsDialog key={materialsLesson?.id ?? "closed"} lesson={materialsLesson} role={role} onOpenChange={(open) => !open && setMaterialsLesson(null)} />
      <OnboardingTour role="teacher" onNavigate={setView} />
      <Toaster position="top-right" richColors />
    </main></GroupActionsProvider>
  );
}
