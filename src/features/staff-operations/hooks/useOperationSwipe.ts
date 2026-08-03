"use client";

import { MODES } from "../constants";
import type { OpMode } from "../types";
import { useStaffSectionSwipe } from "@/hooks/useStaffSectionSwipe";

const OPERATION_SWIPE_CONFIG = {
  key: "operations",
  modes: MODES,
  resolveHref: (mode: OpMode) => `/staff/${mode}`,
} as const;

export function useOperationSwipe(mode: OpMode) {
  useStaffSectionSwipe(mode, OPERATION_SWIPE_CONFIG);
}
