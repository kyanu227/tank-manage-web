"use client";

import StaffSectionTabs from "@/components/StaffSectionTabs";
import { PROCUREMENT_TABS } from "@/features/procurement/constants";
import { useStaffLocale } from "@/hooks/useStaffSession";
import type { Locale } from "@/lib/locale";

type ProcurementHref = (typeof PROCUREMENT_TABS)[number]["href"];

const LABELS = {
  "/staff/supply-order": { ja: "備品・資材発注", en: "Supply order" },
  "/staff/tank-purchase": { ja: "タンク購入", en: "Tank purchase" },
  "/staff/tank-register": { ja: "タンク登録", en: "Tank registration" },
} satisfies Record<ProcurementHref, Record<Locale, string>>;

export function getProcurementTabs(locale: Locale) {
  return PROCUREMENT_TABS.map((tab) => ({ ...tab, label: LABELS[tab.href][locale] }));
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
