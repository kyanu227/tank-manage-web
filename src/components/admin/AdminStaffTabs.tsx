"use client";

import Link from "next/link";
import { BadgeJapaneseYen, Shield, UserRound } from "lucide-react";
import { useAdminCapabilities } from "@/hooks/useAdminCapabilities";
import type { AdminCapability } from "@/lib/admin/adminCapabilities";
import {
  ADMIN_STAFF_TABS,
  getVisibleAdminSectionTabs,
} from "@/lib/admin/adminSectionTabs";
import styles from "./AdminNavigation.module.css";

export type AdminStaffTab = "members" | "permissions" | "compensation";

const staffTabIcons = {
  members: UserRound,
  permissions: Shield,
  compensation: BadgeJapaneseYen,
} as const;

export function getVisibleAdminStaffTabs(
  capabilities: readonly AdminCapability[],
) {
  return getVisibleAdminSectionTabs(ADMIN_STAFF_TABS, capabilities);
}

export default function AdminStaffTabs({ activeTab }: { activeTab: AdminStaffTab }) {
  const { capabilities } = useAdminCapabilities();
  const tabs = getVisibleAdminStaffTabs(capabilities);

  if (tabs.length === 0) {
    return (
      <div role="alert" style={{ marginBottom: 20, padding: 16, borderRadius: 12, border: "1px solid #fed7aa", background: "#fff7ed", color: "#9a3412", fontSize: 13 }}>
        利用できるスタッフ管理機能がありません。ダッシュボードへ戻ってください。
      </div>
    );
  }
  if (tabs.length === 1) return null;

  return (
    <nav className={styles.tabs} aria-label="スタッフ管理">
      {tabs.map((tab) => {
        const Icon = staffTabIcons[tab.id];
        const active = activeTab === tab.id;
        return (
          <Link
            key={tab.id}
            href={tab.href}
            className={`${styles.tabLink} ${active ? styles.tabLinkActive : ""}`}
            aria-current={active ? "page" : undefined}
          >
            <Icon size={16} />
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
