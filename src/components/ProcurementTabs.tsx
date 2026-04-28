"use client";

import StaffSectionTabs from "@/components/StaffSectionTabs";
import { PROCUREMENT_TABS } from "@/features/procurement/constants";

interface ProcurementTabsProps {
  activeHref?: string;
}

export default function ProcurementTabs({ activeHref }: ProcurementTabsProps) {
  return <StaffSectionTabs tabs={PROCUREMENT_TABS} activeHref={activeHref} replace animationKey="procurement" />;
}
