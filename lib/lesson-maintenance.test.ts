import { describe, expect, it } from "vitest";
import { settlePastLessons } from "./lesson-maintenance";

describe("settlePastLessons", () => {
  it("completes trial lessons without charging their balance", async () => {
    const queries: string[] = [];
    const db = {
      prepare(query: string) {
        queries.push(query);
        return { bind: () => ({ query }) };
      },
      batch: async () => [],
    } as unknown as D1Database;

    await settlePastLessons(db, "workspace", 123);

    const chargeQuery = queries.find((query) => query.includes("INSERT OR IGNORE INTO balance_entries"));
    const completionQuery = queries.find((query) => query.includes("UPDATE lessons SET status = 'completed'"));
    expect(chargeQuery).toContain("l.lesson_type = 'regular'");
    expect(completionQuery).toContain("WHEN lesson_type = 'trial' THEN 'waived'");
  });
});
