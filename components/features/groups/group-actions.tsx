"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { GroupDraft, StudentGroup } from "@/components/features/app/types";

// Group actions and data for any screen that shows group sessions, provided once by the teacher app.
export type GroupActions = {
  groups: StudentGroup[];
  createGroup: (group: GroupDraft) => Promise<boolean>;
  updateGroup: (groupId: string, name: string, membersVisible: boolean) => Promise<boolean>;
  setGroupMembers: (groupId: string, memberIds: string[]) => Promise<boolean>;
  setGroupSlots: (groupId: string, slots: GroupDraft["slots"]) => Promise<boolean>;
  archiveGroup: (groupId: string) => Promise<boolean>;
  addGroupSession: (groupId: string, date: string, time: string, durationMinutes: number) => Promise<boolean>;
  cancelGroupSession: (lessonId: string) => Promise<boolean>;
  rescheduleGroupSession: (lessonId: string, date: string, time: string) => Promise<boolean>;
  cancelMemberLesson: (lessonId: string) => Promise<boolean>;
  openGroup: (groupId: string) => void;
};

const GroupActionsContext = createContext<GroupActions | null>(null);

export function GroupActionsProvider({ value, children }: { value: GroupActions; children: ReactNode }) {
  return <GroupActionsContext.Provider value={value}>{children}</GroupActionsContext.Provider>;
}

export function useGroupActions() {
  const value = useContext(GroupActionsContext);
  if (!value) throw new Error("useGroupActions must be used inside GroupActionsProvider");
  return value;
}
