"use client";

import {
  Building2,
  Grab,
  LayoutDashboard,
  ShoppingCart,
  User,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { Locale } from "@/lib/locale";
import { PROCUREMENT_PATHS } from "@/features/procurement/constants";
import { STAFF_SECTION_LABELS } from "./staff-shell-i18n";
import type { StaffMenuSection, StaffNavItemView } from "./staff-shell-types";

interface StaffSectionDefinition {
  readonly section: StaffMenuSection;
  /** menu から遷移する代表route */
  readonly href: string;
  /** このセクションに属する全route。active 判定に使う */
  readonly matchHrefs: readonly string[];
  readonly icon: LucideIcon;
}

const OPERATIONS_PATHS = ["/staff/lend", "/staff/return", "/staff/fill"] as const;
const MAINTENANCE_PATHS = ["/staff/damage", "/staff/repair", "/staff/inspection"] as const;

/** menu 下部の主要操作。右手の親指が最も届く位置に置く */
const OPERATIONS_SECTION: StaffSectionDefinition = {
  section: "operations",
  href: "/staff/lend",
  matchHrefs: OPERATIONS_PATHS,
  icon: Grab,
};

const INHOUSE_SECTION: StaffSectionDefinition = {
  section: "inhouse",
  href: "/staff/inhouse",
  matchHrefs: ["/staff/inhouse"],
  icon: Building2,
};

/** menu 中央。低頻度の遷移先（視覚的正本の並び順） */
const NAVIGATION_SECTIONS: readonly StaffSectionDefinition[] = [
  {
    section: "procurement",
    href: "/staff/supply-order",
    matchHrefs: PROCUREMENT_PATHS,
    icon: ShoppingCart,
  },
  {
    section: "maintenance",
    href: "/staff/damage",
    matchHrefs: MAINTENANCE_PATHS,
    icon: Wrench,
  },
  {
    section: "mypage",
    href: "/staff/mypage",
    matchHrefs: ["/staff/mypage"],
    icon: User,
  },
  {
    section: "dashboard",
    href: "/staff/dashboard",
    matchHrefs: ["/staff/dashboard"],
    icon: LayoutDashboard,
  },
];

const ALL_SECTIONS: readonly StaffSectionDefinition[] = [
  OPERATIONS_SECTION,
  INHOUSE_SECTION,
  ...NAVIGATION_SECTIONS,
];

export const STAFF_OPERATIONS_HREF = OPERATIONS_SECTION.href;
export const STAFF_INHOUSE_HREF = INHOUSE_SECTION.href;
export const STAFF_OPERATIONS_ICON = OPERATIONS_SECTION.icon;
export const STAFF_INHOUSE_ICON = INHOUSE_SECTION.icon;

export function getStaffNavItems(
  locale: Locale,
  activeSection: StaffMenuSection | null,
): StaffNavItemView[] {
  return NAVIGATION_SECTIONS.map((definition) => ({
    section: definition.section,
    href: definition.href,
    label: STAFF_SECTION_LABELS[definition.section][locale],
    icon: definition.icon,
    active: definition.section === activeSection,
  }));
}

/** pathname から現在のセクションを引く。未知のパスは null */
export function resolveStaffSection(
  pathname: string | null | undefined,
): StaffMenuSection | null {
  if (!pathname) return null;
  const matched = ALL_SECTIONS.find((definition) =>
    definition.matchHrefs.includes(pathname),
  );
  return matched?.section ?? null;
}

/** primary zone のどちらが現在地か。それ以外の画面では null */
export function resolveStaffPrimarySection(
  section: StaffMenuSection | null,
): "operations" | "inhouse" | null {
  return section === "operations" || section === "inhouse" ? section : null;
}
