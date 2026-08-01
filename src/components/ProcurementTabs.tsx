"use client";

import StaffSectionTabs from "@/components/StaffSectionTabs";
import { PROCUREMENT_TABS } from "@/features/procurement/constants";
import { useStaffLocale } from "@/hooks/useStaffSession";
import type { Locale } from "@/lib/locale";

type ProcurementHref = (typeof PROCUREMENT_TABS)[number]["href"];

const ENGLISH_LABELS = {
  "/staff/supply-order": "Supply order",
  "/staff/tank-purchase": "Tank purchase",
  "/staff/tank-register": "Tank registration",
} satisfies Record<ProcurementHref, string>;

export function getProcurementTabs(locale: Locale) {
  return locale === "ja"
    ? PROCUREMENT_TABS
    : PROCUREMENT_TABS.map((tab) => ({ ...tab, label: ENGLISH_LABELS[tab.href] }));
}

interface ProcurementTabsProps {
  activeHref?: string;
}

export default function ProcurementTabs({ activeHref }: ProcurementTabsProps) {
  const locale = useStaffLocale();
  const tabs = getProcurementTabs(locale);
  return (
    <StaffSectionTabs
      tabs={tabs}
      activeHref={activeHref}
      ariaLabel={locale === "ja" ? "発注とタンク登録" : "Orders and tank entry"}
      replace
      animationKey="procurement"
    />
  );
}
