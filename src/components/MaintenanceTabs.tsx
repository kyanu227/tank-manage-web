"use client";

import StaffSectionTabs from "@/components/StaffSectionTabs";
import { MAINTENANCE_TABS } from "@/features/maintenance/constants";

/**
 * メンテナンス共通タブバー
 *
 * - `/staff/damage` / `/staff/repair` / `/staff/inspection` の3画面上部に配置
 * - URL はそのまま分割（遷移は Link）
 * - 現在のパスに応じてアクティブ表示を切り替える
 */
export default function MaintenanceTabs() {
  return <StaffSectionTabs tabs={MAINTENANCE_TABS} replace animationKey="maintenance" />;
}
