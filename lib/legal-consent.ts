import { z } from "zod";

export const LEGAL_DOCUMENT_VERSION = "1.0";

export const teacherInviteAcceptanceSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  password: z.string().min(8).max(128),
  acceptedTerms: z.literal(true),
  acceptedPersonalData: z.literal(true),
}).strict();

export const studentInviteAcceptanceSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  password: z.string().min(8).max(128),
  participantStatus: z.enum(["adult", "legal_representative"]),
  acceptedTerms: z.literal(true),
  acceptedPersonalData: z.literal(true),
  acceptedParentalConsent: z.boolean(),
}).strict().superRefine((value, context) => {
  if (value.participantStatus === "legal_representative" && !value.acceptedParentalConsent) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["acceptedParentalConsent"], message: "Требуется согласие законного представителя" });
  }
});

export const baseAcceptanceTypes = ["terms", "content_rules", "personal_data_consent"] as const;
