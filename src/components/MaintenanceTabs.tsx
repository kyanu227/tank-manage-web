"use client";

import StaffSectionTabs from "@/components/StaffSectionTabs";
import { MAINTENANCE_TABS } from "@/features/maintenance/constants";
import { useStaffLocale } from "@/hooks/useStaffSession";
import type { Locale } from "@/lib/locale";

type MaintenanceHref = (typeof MAINTENANCE_TABS)[number]["href"];

const ENGLISH_LABELS = {
  "/staff/damage": "Report damage",
  "/staff/repair": "Complete repair",
  "/staff/inspection": "Complete inspection",
} satisfies Record<MaintenanceHref, string>;

export function getMaintenanceTabs(locale: Locale) {
  return locale === "ja"
    ? MAINTENANCE_TABS
    : MAINTENANCE_TABS.map((tab) => ({ ...tab, label: ENGLISH_LABELS[tab.href] }));
}

/**
 * メンテナンス共通タブバー
 *
 * - `/staff/damage` / `/staff/repair` / `/staff/inspection` の3画面上部に配置
 * - URL はそのまま分割（遷移は Link）
 * - 現在のパスに応じてアクティブ表示を切り替える
 */
export default function MaintenanceTabs() {
  const locale = useStaffLocale();
  const tabs = getMaintenanceTabs(locale);
  return (
    <StaffSectionTabs
      tabs={tabs}
      ariaLabel={locale === "ja" ? "メンテナンス" : "Maintenance"}
      replace
      animationKey="maintenance"
    />
  );
}
