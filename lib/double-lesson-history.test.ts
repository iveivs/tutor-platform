import { describe, expect, it } from "vitest";
import { groupDoubleLessonCharges, groupDoubleLessonEvents } from "./double-lesson-history";

describe("double lesson history", () => {
  it("shows two scheduled parts as one two-hour event", () => {
    const rows = [
      { id: "second", lesson_group_id: "group", event_type: "scheduled", starts_at: 200, ends_at: 300, occurred_at: 11 },
      { id: "first", lesson_group_id: "group", event_type: "scheduled", starts_at: 100, ends_at: 200, occurred_at: 10 },
    ];

    expect(groupDoubleLessonEvents(rows)).toEqual([
      expect.objectContaining({ starts_at: 100, ends_at: 300, occurred_at: 11, note: "2 занятия", lesson_units: 2 }),
    ]);
  });

  it("keeps separate moves of the same double lesson", () => {
    const rows = [
      { id: "1", lesson_group_id: "group", event_type: "rescheduled", starts_at: 100, occurred_at: 10 },
      { id: "2", lesson_group_id: "group", event_type: "rescheduled", starts_at: 200, occurred_at: 10 },
      { id: "3", lesson_group_id: "group", event_type: "rescheduled", starts_at: 300, occurred_at: 20 },
      { id: "4", lesson_group_id: "group", event_type: "rescheduled", starts_at: 400, occurred_at: 20 },
    ];

    expect(groupDoubleLessonEvents(rows)).toHaveLength(2);
  });

  it("shows the two automatic charges as one minus-two entry", () => {
    const rows = [
      { id: "1", lesson_group_id: "group", kind: "lesson_charge", lesson_units: -1, occurred_at: 10 },
      { id: "2", lesson_group_id: "group", kind: "lesson_charge", lesson_units: -1, occurred_at: 20 },
    ];

    expect(groupDoubleLessonCharges(rows)).toEqual([
      expect.objectContaining({ lesson_units: -2, occurred_at: 20, note: "Двойной урок", double_lesson: true }),
    ]);
  });
});
