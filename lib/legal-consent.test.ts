import { describe, expect, it } from "vitest";
import { studentInviteAcceptanceSchema, teacherInviteAcceptanceSchema } from "./legal-consent";

const token = "a".repeat(43);

describe("legal acceptance validation", () => {
  it("requires separate teacher consents", () => {
    expect(teacherInviteAcceptanceSchema.safeParse({ token, password: "password", acceptedTerms: true, acceptedPersonalData: true }).success).toBe(true);
    expect(teacherInviteAcceptanceSchema.safeParse({ token, password: "password", acceptedTerms: true, acceptedPersonalData: false }).success).toBe(false);
  });

  it("requires parental consent for a minor's representative", () => {
    const common = { token, password: "password", acceptedTerms: true as const, acceptedPersonalData: true as const, participantStatus: "legal_representative" as const };
    expect(studentInviteAcceptanceSchema.safeParse({ ...common, acceptedParentalConsent: false }).success).toBe(false);
    expect(studentInviteAcceptanceSchema.safeParse({ ...common, acceptedParentalConsent: true }).success).toBe(true);
  });
});
