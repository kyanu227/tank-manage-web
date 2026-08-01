"use client";

import { AlertTriangle, ShieldCheck, Wrench } from "lucide-react";

export const MAINTENANCE_TABS = [
  { href: "/staff/damage", icon: AlertTriangle, color: "#ef4444" },
  { href: "/staff/repair", icon: Wrench, color: "#0ea5e9" },
  { href: "/staff/inspection", icon: ShieldCheck, color: "#8b5cf6" },
] as const;

export type MaintenanceMode = "damage" | "repair" | "inspection";

export const MAINTENANCE_MODES: MaintenanceMode[] = ["damage", "repair", "inspection"];

export const MAINTENANCE_ROUTE_BY_MODE: Record<MaintenanceMode, string> = {
  damage: "/staff/damage",
  repair: "/staff/repair",
  inspection: "/staff/inspection",
};
