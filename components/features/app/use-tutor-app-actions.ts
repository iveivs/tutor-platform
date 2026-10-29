import type { Dispatch, SetStateAction } from "react";
import { toast } from "sonner";
import type { GroupDraft, LessonDraft, Student, StudentDraft, StudentPrices, StudentRequestDraft, TutorProfile } from "@/components/features/app/types";
import { saveAppData } from "@/lib/app-data-client";
import { russianPlural } from "@/lib/russian-plural";

type TutorAppActionsOptions = {
  reload: () => Promise<void>;
  setProfile: Dispatch<SetStateAction<TutorProfile>>;
  setTeacherName: Dispatch<SetStateAction<string>>;
  setStudents: Dispatch<SetStateAction<Student[]>>;
};

export function useTutorAppActions({ reload, setProfile, setTeacherName, setStudents }: TutorAppActionsOptions) {
  const addLesson = async (lesson: LessonDraft) => {
    try {
      await saveAppData({ action: "createLesson", studentId: lesson.studentId, trialGuestName: lesson.trialGuestName, trialGuestEmail: lesson.trialGuestEmail, trialGuestPhone: lesson.trialGuestPhone, trialGuestNote: lesson.trialGuestNote, date: lesson.date, time: lesson.time, repeat: lesson.repeat, lessonCount: lesson.lessonCount, lessonType: lesson.lessonType });
      await reload();
      toast.success(lesson.lessonType === "trial" ? "Пробное занятие добавлено в расписание" : lesson.lessonCount === 2 ? "Двойной урок добавлен в расписание" : "Урок добавлен в расписание");
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось добавить урок");
      return false;
    }
  };
  const updateLesson = async (lessonId: string, date: string, time: string) => {
    try { await saveAppData({ action: "updateLesson", lessonId, date, time }); await reload(); toast.success("Урок перенесён"); return true; }
    catch (error) { toast.error(error instanceof Error ? error.message : "Не удалось перенести урок"); return false; }
  };
  const deleteLesson = async (lessonId: string) => {
    try { await saveAppData({ action: "deleteLesson", lessonId }); await reload(); toast.success("Урок отменён без списания"); return true; }
    catch (error) { toast.error(error instanceof Error ? error.message : "Не удалось отменить урок"); return false; }
  };
  const stopLessonSeries = async (seriesId: string) => {
    try { await saveAppData({ action: "stopLessonSeries", seriesId }); await reload(); toast.success("Постоянное занятие остановлено"); return true; }
    catch (error) { toast.error(error instanceof Error ? error.message : "Не удалось остановить расписание"); return false; }
  };
  const updateStudent = async (student: Pick<Student, "id" | "name" | "email" | "canViewAvailability">) => {
    try { await saveAppData({ action: "updateStudent", studentId: student.id, name: student.name, email: student.email, canViewAvailability: student.canViewAvailability }); await reload(); toast.success("Данные ученика сохранены"); return true; }
    catch (error) { toast.error(error instanceof Error ? error.message : "Не удалось сохранить данные ученика"); return false; }
  };
  const updateStudentPrices = async (studentId: string, prices: StudentPrices) => {
    try {
      await saveAppData({ action: "updateStudentPrices", studentId, lessonPriceCents: prices.lessonCents, doubleLessonPriceCents: prices.doubleLessonCents, trialLessonPriceCents: prices.trialLessonCents, priceCurrency: prices.currency });
      await reload(); toast.success("Стоимость занятий сохранена"); return true;
    } catch (error) { toast.error(error instanceof Error ? error.message : "Не удалось сохранить стоимость"); return false; }
  };
  // Group lessons. Each action reloads the data and reports the result; it returns whether it succeeded.
  const groupAction = async (body: Record<string, unknown>, success: string, failure: string) => {
    try { await saveAppData(body); await reload(); toast.success(success); return true; }
    catch (error) { toast.error(error instanceof Error ? error.message : failure); return false; }
  };
  const createGroup = (group: GroupDraft) => groupAction({ action: "createGroup", ...group }, "Группа создана", "Не удалось создать группу");
  const updateGroup = (groupId: string, name: string, membersVisible: boolean) => groupAction({ action: "updateGroup", groupId, name, membersVisible }, "Группа сохранена", "Не удалось сохранить группу");
  const setGroupMembers = (groupId: string, memberIds: string[]) => groupAction({ action: "setGroupMembers", groupId, memberIds }, "Состав группы сохранён", "Не удалось изменить состав");
  const setGroupSlots = (groupId: string, slots: GroupDraft["slots"]) => groupAction({ action: "setGroupSlots", groupId, slots }, "Расписание группы сохранено", "Не удалось изменить расписание");
  const archiveGroup = (groupId: string) => groupAction({ action: "archiveGroup", groupId }, "Группа перенесена в архив", "Не удалось архивировать группу");
  const addGroupSession = (groupId: string, date: string, time: string, durationMinutes: number) => groupAction({ action: "addGroupSession", groupId, date, time, durationMinutes }, "Занятие группы добавлено", "Не удалось добавить занятие");
  const cancelGroupSession = (lessonId: string) => groupAction({ action: "cancelGroupSession", lessonId }, "Занятие отменено для всей группы", "Не удалось отменить занятие");
  const rescheduleGroupSession = (lessonId: string, date: string, time: string) => groupAction({ action: "rescheduleGroupSession", lessonId, date, time }, "Занятие группы перенесено", "Не удалось перенести занятие");
  const convertTrialContact = async (studentId: string) => {
    try { await saveAppData({ action: "convertTrialContact", studentId }); await reload(); toast.success("Карточка ученика создана"); return true; }
    catch (error) { toast.error(error instanceof Error ? error.message : "Не удалось создать ученика"); return false; }
  };
  const restoreStudent = async (studentId: string) => {
    try { await saveAppData({ action: "restoreStudent", studentId }); await reload(); toast.success("Ученик восстановлен"); return true; }
    catch (error) { toast.error(error instanceof Error ? error.message : "Не удалось восстановить ученика"); return false; }
  };
  const deleteStudentPermanently = async (studentId: string) => {
    try { await saveAppData({ action: "deleteStudent", studentId }); await reload(); toast.success("Ученик и связанные данные удалены"); return true; }
    catch (error) { toast.error(error instanceof Error ? error.message : "Не удалось удалить ученика"); return false; }
  };
  const addStudent = async (student: StudentDraft) => {
    try {
      const created = await saveAppData({ action: "createStudent", name: student.name, email: student.email, floating: student.floating, weekday: student.weekday, time: student.time, ...(student.groupId ? { groupId: student.groupId } : {}) }) as { id?: string };
      if (student.guardian && created.id) await saveAppData({ action: "updateStudentGuardian", studentId: created.id, guardian: student.guardian });
      await reload();
      toast.success(student.email ? "Ученик создан. Пригласить его можно из карточки" : "Ученик создан");
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось создать ученика");
      return false;
    }
  };
  const createStudentInvite = async (studentId: string) => {
    const result = await saveAppData({ action: "createStudentInvite", studentId });
    if (!result.inviteUrl) throw new Error("Ссылка не была создана");
    return result.inviteUrl;
  };
  const addPayment = async (studentId: string, count: number, paymentDate: string, amountCents?: number | null) => {
    try { await saveAppData({ action: "addPayment", studentId, count, paymentDate, ...(amountCents !== undefined ? { amountCents } : {}) }); await reload(); toast.success(`Добавлено ${russianPlural(count, "занятие", "занятия", "занятий")}`); return true; }
    catch (error) { toast.error(error instanceof Error ? error.message : "Не удалось добавить оплату"); return false; }
  };
  const adjustBalance = async (studentId: string, units: number, note: string) => {
    try {
      await saveAppData({ action: "adjustBalance", studentId, units, note });
      setStudents((current) => current.map((student) => student.id === studentId ? { ...student, balance: student.balance + units } : student));
      await reload().catch(() => undefined);
      toast.success("Баланс скорректирован"); return true;
    }
    catch (error) { toast.error(error instanceof Error ? error.message : "Не удалось скорректировать баланс"); return false; }
  };
  const reversePayment = async (paymentId: string) => {
    try { await saveAppData({ action: "reversePayment", paymentId }); await reload(); toast.success("Оплата отменена, баланс пересчитан"); return true; }
    catch (error) { toast.error(error instanceof Error ? error.message : "Не удалось отменить оплату"); return false; }
  };
  const submitStudentRequest = async (body: StudentRequestDraft) => {
    try { const result = await saveAppData({ action: "submitStudentRequest", ...body }); await reload(); toast.success(result.cancelled ? "Отмечено: вы не придёте. Преподаватель получил уведомление" : "Запрос отправлен преподавателю"); return true; }
    catch (error) { toast.error(error instanceof Error ? error.message : "Не удалось отправить запрос"); return false; }
  };
  const markNotificationsRead = async (notificationId?: string) => {
    try { await saveAppData({ action: "markNotificationsRead", ...(notificationId ? { notificationId } : {}) }); await reload(); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Не удалось обновить уведомления"); }
  };
  const updateProfile = async (name: string, professionalTitle: string) => {
    await saveAppData({ action: "updateProfile", name, professionalTitle });
    setProfile((current) => ({ ...current, name, professionalTitle }));
    setTeacherName(name);
    toast.success("Профиль сохранён");
  };
  const updateAvailability = async (windows: Array<{ weekday: number; start: string; end: string }>) => {
    await saveAppData({ action: "replaceAvailability", windows });
    await reload();
    toast.success("Рабочие часы сохранены");
  };
  const saveTeacherDayNote = async (date: string, body: string) => {
    try {
      await saveAppData({ action: "saveTeacherDayNote", date, body });
      await reload();
      toast.success(body.trim() ? "Заметка на день сохранена" : "Заметка на день удалена");
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось сохранить заметку");
      return false;
    }
  };
  return {
    addLesson,
    updateLesson,
    deleteLesson,
    stopLessonSeries,
    updateStudent,
    updateStudentPrices,
    createGroup,
    updateGroup,
    setGroupMembers,
    setGroupSlots,
    archiveGroup,
    addGroupSession,
    cancelGroupSession,
    rescheduleGroupSession,
    convertTrialContact,
    restoreStudent,
    deleteStudentPermanently,
    addStudent,
    createStudentInvite,
    addPayment,
    adjustBalance,
    reversePayment,
    submitStudentRequest,
    markNotificationsRead,
    updateProfile,
    updateAvailability,
    saveTeacherDayNote,
  };
}

