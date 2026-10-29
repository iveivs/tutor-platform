import { z } from "zod";

// A student's account may be run by a parent or another trusted adult. The student card stays
// the child's (schedule, payments, statistics); the guardian is shown where people talk.
export const GUARDIAN_RELATIONS = ["father", "mother", "grandfather", "grandmother", "uncle", "aunt", "brother", "sister", "guardian", "nanny", "other"] as const;
export type GuardianRelation = (typeof GUARDIAN_RELATIONS)[number];
export type Guardian = { name: string; relation: GuardianRelation; relationOther: string | null };

export const guardianRelationLabel: Record<Exclude<GuardianRelation, "other">, string> = {
  father: "папа", mother: "мама", grandfather: "дедушка", grandmother: "бабушка", uncle: "дядя", aunt: "тётя",
  brother: "брат", sister: "сестра", guardian: "опекун", nanny: "няня",
};

export const guardianSchema = z.object({
  name: z.string().trim().min(1).max(80),
  relation: z.enum(GUARDIAN_RELATIONS),
  relationOther: z.string().trim().max(30).nullable(),
}).strict().refine((value) => value.relation !== "other" || Boolean(value.relationOther), { message: "Укажите, кем приходится" });

/** Normalizes a parsed guardian for storage: the free-text status only for "other". */
export function guardianColumns(guardian: Guardian | null) {
  if (!guardian) return [null, null, null] as const;
  return [guardian.name.trim(), guardian.relation, guardian.relation === "other" ? guardian.relationOther?.trim() || null : null] as const;
}

export function guardianFromRow(row: { guardian_name?: unknown; guardian_relation?: unknown; guardian_relation_other?: unknown }): Guardian | null {
  if (!row.guardian_name || !row.guardian_relation) return null;
  return { name: String(row.guardian_name), relation: row.guardian_relation as GuardianRelation, relationOther: row.guardian_relation_other ? String(row.guardian_relation_other) : null };
}

export const relationText = (guardian: Guardian) => guardian.relation === "other" ? guardian.relationOther ?? "" : guardianRelationLabel[guardian.relation];

/** "Игорь (папа) · Миша Соколов" for chats; the child's name alone without a guardian. */
export function speakerName(childName: string, guardian: Guardian | null) {
  return guardian ? `${guardian.name} (${relationText(guardian)}) · ${childName}` : childName;
}
