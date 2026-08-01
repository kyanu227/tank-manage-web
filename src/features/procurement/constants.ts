"use client";

import { Package, Plus, ShoppingCart } from "lucide-react";

export const PROCUREMENT_TABS = [
  { href: "/staff/supply-order", icon: ShoppingCart, color: "#f59e0b" },
  { href: "/staff/tank-purchase", icon: Package, color: "#0ea5e9" },
  { href: "/staff/tank-register", icon: Plus, color: "#10b981" },
] as const;

export const PROCUREMENT_PATHS = [...PROCUREMENT_TABS.map((tab) => tab.href), "/staff/order"];

export type ProcurementMode = "supply-order" | "tank-purchase" | "tank-register";

export const PROCUREMENT_ROUTE_BY_MODE: Record<ProcurementMode, string> = {
  "supply-order": "/staff/supply-order",
  "tank-purchase": "/staff/tank-purchase",
  "tank-register": "/staff/tank-register",
};

export const PROCUREMENT_MODES: ProcurementMode[] = ["supply-order", "tank-purchase", "tank-register"];
