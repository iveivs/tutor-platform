"use client";

import { useState, type ReactNode } from "react";
import { UserRound } from "lucide-react";
import { toast } from "sonner";
import { FormField } from "@/components/common/form-field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { saveAppData } from "@/lib/app-data-client";
import { GUARDIAN_RELATIONS, guardianRelationLabel, relationText, type Guardian, type GuardianRelation } from "@/lib/guardian";

export type GuardianDraft = { enabled: boolean; name: string; relation: GuardianRelation; relationOther: string };

export const guardianDraft = (guardian?: Guardian | null): GuardianDraft => ({ enabled: Boolean(guardian), name: guardian?.name ?? "", relation: guardian?.relation ?? "mother", relationOther: guardian?.relationOther ?? "" });
export const guardianDraftValid = (draft: GuardianDraft) => !draft.enabled || draft.name.trim().length > 0 && (draft.relation !== "other" || draft.relationOther.trim().length > 0);
export const guardianFromDraft = (draft: GuardianDraft): Guardian | null => draft.enabled ? { name: draft.name.trim(), relation: draft.relation, relationOther: draft.relation === "other" ? draft.relationOther.trim() : null } : null;

/** Name and relation of the adult; shared by the teacher's student card and the invitation. */
export function GuardianFields({ draft, onChange, nameLabel = "Имя взрослого", relationLabel = "Кем приходится" }: { draft: GuardianDraft; onChange: (draft: GuardianDraft) => void; nameLabel?: string; relationLabel?: string }) {
  return <div className="grid gap-3">
    <div className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] gap-3">
      <FormField label={nameLabel}><Input value={draft.name} maxLength={80} onChange={(event) => onChange({ ...draft, name: event.target.value })} className="h-11 rounded-xl" /></FormField>
      <FormField label={relationLabel}><Select value={draft.relation} onValueChange={(value) => onChange({ ...draft, relation: value as GuardianRelation })}><SelectTrigger className="h-11 w-full rounded-xl"><SelectValue /></SelectTrigger><SelectContent>{GUARDIAN_RELATIONS.map((relation) => <SelectItem key={relation} value={relation}>{relation === "other" ? "другое…" : guardianRelationLabel[relation]}</SelectItem>)}</SelectContent></Select></FormField>
    </div>
    {draft.relation === "other" && <FormField label="Кем приходится *"><Input value={draft.relationOther} maxLength={30} placeholder="Например: крёстный" onChange={(event) => onChange({ ...draft, relationOther: event.target.value })} className="h-11 rounded-xl" required /></FormField>}
  </div>;
}

export const guardianSummary = (guardian?: Guardian | null) => guardian ? `${guardian.name}, ${relationText(guardian)}` : "Сам ученик";

// Student card: «Кабинет ведёт родитель или доверенное лицо». The card itself stays the child's.
export function GuardianDialog({ studentId, guardian, onSaved, trigger }: { studentId: string; guardian?: Guardian | null; onSaved: () => Promise<void>; trigger: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<GuardianDraft>(() => guardianDraft(guardian));
  const [pending, setPending] = useState(false);
  const save = async () => {
    setPending(true);
    try {
      await saveAppData({ action: "updateStudentGuardian", studentId, guardian: guardianFromDraft(draft) });
      await onSaved(); toast.success("Сохранено"); setOpen(false);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Не удалось сохранить"); }
    finally { setPending(false); }
  };
  return <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (next) setDraft(guardianDraft(guardian)); }}>
    <DialogTrigger asChild>{trigger}</DialogTrigger>
    <DialogContent className="rounded-3xl sm:max-w-md">
      <DialogHeader><DialogTitle>Кто ведёт кабинет</DialogTitle><DialogDescription>Для детей: войдёт и будет писать взрослый. В расписании, оплатах и статистике остаётся имя ученика.</DialogDescription></DialogHeader>
      <label className="flex items-center justify-between gap-3 rounded-2xl border border-line p-3.5"><span className="flex items-center gap-2.5 text-[15px] font-semibold"><UserRound className="size-5 text-brand-text" />Кабинет ведёт родитель или доверенное лицо</span><Switch checked={draft.enabled} onCheckedChange={(enabled) => setDraft({ ...draft, enabled })} /></label>
      {draft.enabled && <GuardianFields draft={draft} onChange={setDraft} />}
      <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Отмена</Button><Button disabled={pending || !guardianDraftValid(draft)} onClick={() => void save()}>{pending ? "Сохраняю…" : "Сохранить"}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
