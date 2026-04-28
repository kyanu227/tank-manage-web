"use client";

import { Package, Plus, ShoppingCart } from "lucide-react";
import type { StaffSectionTabItem } from "@/components/StaffSectionTabs";

export const PROCUREMENT_TABS: StaffSectionTabItem[] = [
  { href: "/staff/order", label: "資材発注", icon: ShoppingCart, color: "#f59e0b" },
  { href: "/staff/tank-purchase", label: "タンク購入", icon: Package, color: "#0ea5e9" },
  { href: "/staff/tank-register", label: "タンク登録", icon: Plus, color: "#10b981" },
];

export const PROCUREMENT_PATHS = PROCUREMENT_TABS.map((tab) => tab.href);

export type ProcurementMode = "order" | "tank-purchase" | "tank-register";

export const PROCUREMENT_ROUTE_BY_MODE: Record<ProcurementMode, string> = {
  order: "/staff/order",
  "tank-purchase": "/staff/tank-purchase",
  "tank-register": "/staff/tank-register",
};

export const PROCUREMENT_MODES: ProcurementMode[] = ["order", "tank-purchase", "tank-register"];
