"use client";

import { AlertTriangle, ShieldCheck, Wrench } from "lucide-react";
import type { StaffSectionTabItem } from "@/components/StaffSectionTabs";

export const MAINTENANCE_TABS: StaffSectionTabItem[] = [
  { href: "/staff/damage", label: "破損報告", icon: AlertTriangle, color: "#ef4444" },
  { href: "/staff/repair", label: "修理完了", icon: Wrench, color: "#0ea5e9" },
  { href: "/staff/inspection", label: "耐圧検査完了", icon: ShieldCheck, color: "#8b5cf6" },
];

export type MaintenanceMode = "damage" | "repair" | "inspection";

export const MAINTENANCE_MODES: MaintenanceMode[] = ["damage", "repair", "inspection"];

export const MAINTENANCE_ROUTE_BY_MODE: Record<MaintenanceMode, string> = {
  damage: "/staff/damage",
  repair: "/staff/repair",
  inspection: "/staff/inspection",
};
