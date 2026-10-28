import { describe, expect, it } from "vitest";
import type { Lesson } from "@/components/features/app/types";
import { combineGroupSessions } from "./group-sessions";

const lesson = (patch: Partial<Lesson>): Lesson => ({ id: "l", studentId: "s", date: "2026-10-29", time: "12:00", end: "13:30", name: "Анна", status: "paid", label: "Оплачен", units: 1, ...patch });

describe("combineGroupSessions", () => {
  it("merges member rows of one session and keeps individual lessons", () => {
    const result = combineGroupSessions([
      lesson({ id: "a", studentId: "s1", name: "Анна", classId: "g", className: "Хор" }),
      lesson({ id: "b", studentId: "s2", name: "Борис", classId: "g", className: "Хор", status: "debt", label: "Баланс -1" }),
      lesson({ id: "c", studentId: "s3", name: "Вера", time: "15:00", end: "16:00" }),
    ], [{ lessonId: "x", classId: "g", studentId: "s4", studentName: "Глеб", startsAt: new Date("2026-10-29T12:00:00+03:00").getTime() }]);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ id: "a", name: "Хор" });
    expect(result[0].participants?.map((participant) => participant.name)).toEqual(["Анна", "Борис"]);
    expect(result[0].absentees?.map((absence) => absence.studentName)).toEqual(["Глеб"]);
    expect(result[1]).toMatchObject({ id: "c", name: "Вера" });
    expect(result[1].participants).toBeUndefined();
  });
});
