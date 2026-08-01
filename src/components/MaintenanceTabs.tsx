"use client";

import StaffSectionTabs from "@/components/StaffSectionTabs";
import { MAINTENANCE_TABS } from "@/features/maintenance/constants";
import { useStaffLocale } from "@/hooks/useStaffSession";
import type { Locale } from "@/lib/locale";

type MaintenanceHref = (typeof MAINTENANCE_TABS)[number]["href"];

const LABELS = {
  "/staff/damage": { ja: "破損報告", en: "Report damage" },
  "/staff/repair": { ja: "修理完了", en: "Complete repair" },
  "/staff/inspection": { ja: "耐圧検査完了", en: "Complete inspection" },
} satisfies Record<MaintenanceHref, Record<Locale, string>>;

export function getMaintenanceTabs(locale: Locale) {
  return MAINTENANCE_TABS.map((tab) => ({ ...tab, label: LABELS[tab.href][locale] }));
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
