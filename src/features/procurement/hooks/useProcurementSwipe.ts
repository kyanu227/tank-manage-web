"use client";

import {
  PROCUREMENT_MODES,
  PROCUREMENT_ROUTE_BY_MODE,
  type ProcurementMode,
} from "@/features/procurement/constants";
import { useStaffSectionSwipe } from "@/hooks/useStaffSectionSwipe";

const PROCUREMENT_SWIPE_CONFIG = {
  key: "procurement",
  modes: PROCUREMENT_MODES,
  resolveHref: (mode: ProcurementMode) => PROCUREMENT_ROUTE_BY_MODE[mode],
} as const;

export function useProcurementSwipe(mode: ProcurementMode) {
  useStaffSectionSwipe(mode, PROCUREMENT_SWIPE_CONFIG);
}
