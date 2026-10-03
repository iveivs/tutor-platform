import { describe, expect, it } from "vitest";
import { convertD1Query } from "../db/postgres-d1";

describe("PostgreSQL D1 compatibility", () => {
  it("numbers placeholders without touching question marks in strings", () => {
    const query = convertD1Query("SELECT '?' AS literal FROM members WHERE id = ? AND (? IS NULL OR email = ?)", ["m1", null, "a@example.com"]);
    expect(query.text).toBe("SELECT '?' AS literal FROM members WHERE id = $1 AND ($2::text IS NULL OR email = $3)");
    expect(query.values).toEqual(["m1", null, "a@example.com"]);
  });

  it("converts timestamp bindings on inserts and comparisons", () => {
    const now = 1_790_000_000_123;
    const query = convertD1Query("INSERT INTO lessons (id, starts_at, ends_at) VALUES (?, ?, ?)", ["l1", now, now + 3_600_000]);
    expect(query.text).toBe("INSERT INTO lessons (id, starts_at, ends_at) VALUES ($1, $2, $3)");
    expect(query.values).toEqual(["l1", new Date(now), new Date(now + 3_600_000)]);

    const comparison = convertD1Query("SELECT id FROM lessons WHERE ends_at <= ?", [now]);
    expect(comparison.values).toEqual([new Date(now)]);
  });

  it("maps SQLite ignore, booleans, auth subject and random ids", () => {
    const query = convertD1Query(
      "INSERT OR IGNORE INTO users (id, auth_subject, is_platform_admin) SELECT lower(hex(randomblob(16))), ?, 1 WHERE is_platform_admin = 0",
      ["legacy-id"],
    );
    expect(query.text).toContain("INSERT INTO users");
    expect(query.text).toContain("legacy_auth_subject");
    expect(query.text).toContain("replace(gen_random_uuid()::text, '-', '')");
    expect(query.text).toContain("is_platform_admin = false");
    expect(query.text).toMatch(/ON CONFLICT DO NOTHING$/);
  });
});
