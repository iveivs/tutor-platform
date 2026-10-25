"use client";
import { useState } from "react";
import { MobileHeader, MobileNav, Sidebar } from "@/components/common/app-navigation";
import { getActivityAttentionCount } from "@/components/features/activity/activity-model";
import { ActivityView } from "@/components/features/activity/activity-view";
import { useScheduleModelContext } from "@/components/features/app/use-schedule-model-context";
import { useTutorAppData } from "@/components/features/app/use-tutor-app-data";
import { CalendarView, TodayView } from "@/components/features/schedule/schedule-views";
import { LessonMaterialsDialog } from "@/components/features/materials/lesson-materials-dialog";
import { TeacherMaterialsView } from "@/components/features/materials/teacher-materials-view";
import { StudentPortal } from "@/components/features/student-portal/student-portal";
import { SettingsView } from "@/components/features/settings/settings-view";
import { StudentsView, StudentView } from "@/components/features/students/student-views";
import type { CurrentUser, Lesson, View } from "@/components/features/app/types";
import { BrandIcon } from "@/components/brand-icon";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";

export default function TutorApp({ role = "owner", user, onLogout }: { role?: "owner" | "teacher" | "student"; user?: CurrentUser; onLogout?: () => void }) {
  const preferenceScope = user?.email || role;
  const [view, setView] = useState<View>("today");
  const [materialsLesson, setMaterialsLesson] = useState<Lesson | null>(null);
  const {
    lessons, students, recurringSlots, requests, balanceEntries, historyEvents, notifications,
    availabilityWindows, availableSlots, dayNotes, profile, teacherName, selectedStudent, setSelectedStudent,
    loading, loadError, showPastLessons, pastLessonsLoading, reload, retry, changePastLessonsVisibility,
    addLesson, updateLesson, deleteLesson, stopLessonSeries, updateStudent, convertTrialContact,
    restoreStudent, deleteStudentPermanently, addStudent, createStudentInvite, addPayment, adjustBalance,
    reversePayment, submitStudentRequest, markNotificationsRead, updateProfile, updateAvailability, saveTeacherDayNote,
  } = useTutorAppData({ role, user, preferenceScope });

  useScheduleModelContext({ lessons, students, reload });

  if (loading) return <main className="grid min-h-screen place-items-center bg-background text-foreground"><div className="text-center"><BrandIcon className="mx-auto mb-3 size-12 animate-pulse" /><p className="font-semibold">Загружаю расписание…</p></div></main>;
  if (loadError) return <main className="grid min-h-screen place-items-center bg-background px-4 text-foreground"><div className="card max-w-md p-7 text-center"><h1 className="text-xl font-bold">Данные временно недоступны</h1><p className="mt-2 text-ink-muted">Локальная база не ответила. Попробуйте ещё раз.</p><Button className="mt-5 bg-brand-solid" onClick={() => void retry()}>Повторить</Button></div></main>;
  const activeLessons = lessons.filter((lesson) => !lesson.past);
  const activeStudents = students.filter((student) => !student.archived);
  const activityCount = getActivityAttentionCount(requests, notifications);
  const portalStudent = students.find((student) => student.id === selectedStudent) ?? students[0];
  if (role === "student") return portalStudent
    ? <><StudentPortal student={portalStudent} teacherName={teacherName} lessons={lessons} entries={balanceEntries} historyEvents={historyEvents} requests={requests} notifications={notifications} availableSlots={availableSlots} onReadNotifications={markNotificationsRead} onRequest={submitStudentRequest} onMaterials={setMaterialsLesson} onBack={onLogout ?? (() => undefined)} onReload={reload} /><LessonMaterialsDialog key={materialsLesson?.id ?? "closed"} lesson={materialsLesson} role={role} onOpenChange={(open) => !open && setMaterialsLesson(null)} /></>
    : <main className="grid min-h-screen place-items-center bg-background px-4 text-foreground"><div className="card max-w-md p-7 text-center"><h1 className="text-xl font-bold">Кабинет ученика не найден</h1><p className="mt-2 text-ink-muted">Аккаунт вошёл, но не связан с карточкой ученика. Попросите преподавателя создать новое приглашение.</p><Button className="mt-5" variant="outline" onClick={onLogout}>Выйти</Button></div></main>;

  return (
    <main className="min-h-screen bg-background text-foreground">
      <Sidebar view={view} setView={setView} name={profile.name} professionalTitle={profile.professionalTitle} onLogout={onLogout} activityCount={activityCount} />
      <section className="min-h-screen pb-24 lg:ml-[var(--sidebar-width)] lg:pb-0">
        <MobileHeader name={profile.name} professionalTitle={profile.professionalTitle} activityCount={activityCount} onActivity={() => setView("activity")} view={view} />
        {view === "today" && <TodayView lessons={activeLessons} students={activeStudents} requests={requests} dayNotes={dayNotes} onSaveDayNote={saveTeacherDayNote} onAdd={addLesson} onUpdate={updateLesson} onDelete={deleteLesson} onMaterials={setMaterialsLesson} setView={setView} onOpenStudent={(id) => { setSelectedStudent(id); setView("student"); }} />}
        {view === "calendar" && <CalendarView preferenceScope={preferenceScope} lessons={lessons} students={students.filter((student) => !student.archived)} dayNotes={dayNotes} onSaveDayNote={saveTeacherDayNote} showPastLessons={showPastLessons} pastLessonsLoading={pastLessonsLoading} onShowPastLessonsChange={changePastLessonsVisibility} onAdd={addLesson} onUpdate={updateLesson} onDelete={deleteLesson} onMaterials={setMaterialsLesson} onConvertTrial={convertTrialContact} onOpenStudent={(id) => { setSelectedStudent(id); setView("student"); }} />}
        {view === "students" && <StudentsView students={students} onAdd={addStudent} onOpen={(id) => { setSelectedStudent(id); setView("student"); }} />}
        {view === "student" && students.length > 0 && <StudentView student={students.find((student) => student.id === selectedStudent) ?? students[0]} lessons={activeLessons} recurringSlots={recurringSlots} balanceEntries={balanceEntries} historyEvents={historyEvents} onAdd={addLesson} onBack={() => setView("students")} onPay={addPayment} onAdjustBalance={adjustBalance} onReversePayment={reversePayment} onCreateInvite={createStudentInvite} onUpdate={updateStudent} onStopSeries={stopLessonSeries} onRestore={restoreStudent} onDeletePermanently={async (studentId) => { const deleted = await deleteStudentPermanently(studentId); if (deleted) setView("students"); return deleted; }} onReload={reload} />}
        {view === "activity" && <ActivityView requests={requests} notifications={notifications} historyEvents={historyEvents} students={students} preferenceScope={preferenceScope} onResolved={reload} onReadNotifications={markNotificationsRead} onReversePayment={reversePayment} />}
        {view === "materials" && <TeacherMaterialsView />}
        {view === "settings" && <SettingsView profile={profile} availabilityWindows={availabilityWindows} onSave={updateProfile} onSaveAvailability={updateAvailability} onLogout={onLogout} isPlatformAdmin={Boolean(user?.isPlatformAdmin)} />}
      </section>
      <MobileNav view={view} setView={setView} />
      <LessonMaterialsDialog key={materialsLesson?.id ?? "closed"} lesson={materialsLesson} role={role} onOpenChange={(open) => !open && setMaterialsLesson(null)} />
      <Toaster position="top-right" richColors />
    </main>
  );
}
