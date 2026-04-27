"use client";

import { MODE_CONFIG, MODES } from "../constants";
import type { OpMode } from "../types";
import StaffSectionTabs, { type StaffSectionTabItem } from "@/components/StaffSectionTabs";

interface OperationModeTabsProps {
  mode: OpMode;
}

export default function OperationModeTabs({ mode }: OperationModeTabsProps) {
  const tabs: StaffSectionTabItem[] = MODES.map((m) => {
    const config = MODE_CONFIG[m];
    return {
      href: `/staff/${m}`,
      label: config.label,
      icon: config.icon,
      color: config.color,
    };
  });

  return <StaffSectionTabs tabs={tabs} activeHref={`/staff/${mode}`} fontSize={13} iconSize={16} replace animationKey="operations" />;
}
