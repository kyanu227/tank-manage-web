"use client";

import {
  MAINTENANCE_MODES,
  MAINTENANCE_ROUTE_BY_MODE,
  type MaintenanceMode,
} from "@/features/maintenance/constants";
import { useStaffSectionSwipe } from "@/hooks/useStaffSectionSwipe";

const MAINTENANCE_SWIPE_CONFIG = {
  key: "maintenance",
  modes: MAINTENANCE_MODES,
  resolveHref: (mode: MaintenanceMode) => MAINTENANCE_ROUTE_BY_MODE[mode],
} as const;

export function useMaintenanceSwipe(mode: MaintenanceMode) {
  useStaffSectionSwipe(mode, MAINTENANCE_SWIPE_CONFIG);
}
