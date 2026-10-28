import { describe, expect, it } from "vitest";
import { periodLength, summarizeLessons, type LessonRow } from "./teacher-stats";

const row = (patch: Partial<LessonRow>): LessonRow => ({ lesson_key: "l", student_ids: ["s1"], local_date: "2026-10-02", minutes: 60, status: "completed", trial: false, ...patch });

describe("teacher stats", () => {
  it("counts lessons, minutes, days and students of the period", () => {
    const summary = summarizeLessons([
      row({ lesson_key: "a" }),
      row({ lesson_key: "b", student_ids: ["s2"], minutes: 120 }),
      row({ lesson_key: "c", local_date: "2026-10-03", trial: true }),
      row({ lesson_key: "d", status: "cancelled" }),
      row({ lesson_key: "e", status: "scheduled", local_date: "2026-10-04" }),
    ], "2026-10-01", "2026-10-04");
    expect(summary).toMatchObject({ completed: 3, minutes: 240, trial: 1, cancelled: 1, planned: 1, workingDays: 2, activeStudents: 2 });
    expect(summary.daily).toEqual([
      { date: "2026-10-01", lessons: 0 }, { date: "2026-10-02", lessons: 2 }, { date: "2026-10-03", lessons: 1 }, { date: "2026-10-04", lessons: 0 },
    ]);
  });

  it("counts a group session once and every member who came", () => {
    const summary = summarizeLessons([row({ lesson_key: "class:1", student_ids: ["s1", "s2", "s3"], minutes: 90 })], "2026-10-02", "2026-10-02");
    expect(summary).toMatchObject({ completed: 1, minutes: 90, activeStudents: 3 });
  });

  it("measures periods inclusively", () => {
    expect(periodLength("2026-10-01", "2026-10-31")).toBe(31);
    expect(periodLength("2026-10-26", "2026-10-26")).toBe(1);
  });
});
