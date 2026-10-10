import { z } from "zod";

export const LEGAL_DOCUMENT_VERSION = "1.0";
export const CONTENT_RULES_VERSION = "1.1";

export const teacherInviteAcceptanceSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  password: z.string().min(8).max(128),
  acceptedTerms: z.literal(true),
  acceptedContentRules: z.literal(true),
  acceptedPersonalData: z.literal(true),
}).strict();

export const studentInviteAcceptanceSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  password: z.string().min(8).max(128),
  participantStatus: z.enum(["adult", "legal_representative"]),
  acceptedTerms: z.literal(true),
  acceptedContentRules: z.literal(true),
  acceptedPersonalData: z.literal(true),
  acceptedParentalConsent: z.boolean(),
}).strict().superRefine((value, context) => {
  if (value.participantStatus === "legal_representative" && !value.acceptedParentalConsent) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["acceptedParentalConsent"], message: "Требуется согласие законного представителя" });
  }
});

export const baseAcceptanceDocuments = [
  { type: "terms", version: LEGAL_DOCUMENT_VERSION },
  { type: "content_rules", version: CONTENT_RULES_VERSION },
  { type: "personal_data_consent", version: LEGAL_DOCUMENT_VERSION },
] as const;

export const baseAcceptanceTypes = baseAcceptanceDocuments.map((document) => document.type);
