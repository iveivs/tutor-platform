"use client";

import { useState } from "react";
import { useVisiblePolling } from "@/hooks/use-visible-polling";
import { today } from "@/lib/date-time";

export function useCurrentDay() {
  const [currentDay, setCurrentDay] = useState(today);
  useVisiblePolling(async () => setCurrentDay(today()));
  return currentDay;
}
