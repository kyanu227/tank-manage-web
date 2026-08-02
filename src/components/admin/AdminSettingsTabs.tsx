"use client";

import Link from "next/link";
import { Bell, SlidersHorizontal, Workflow } from "lucide-react";
import { useAdminCapabilities } from "@/hooks/useAdminCapabilities";
import {
  ADMIN_SETTINGS_TABS,
  getVisibleAdminSectionTabs,
} from "@/lib/admin/adminSectionTabs";
import styles from "./AdminNavigation.module.css";

export type AdminSettingsTab = "businessRules" | "notifications" | "operationMode";

const tabIcons = {
  businessRules: SlidersHorizontal,
  notifications: Bell,
  operationMode: Workflow,
} as const;

export default function AdminSettingsTabs({ activeTab }: { activeTab: AdminSettingsTab }) {
  const { capabilities } = useAdminCapabilities();
  const tabs = getVisibleAdminSectionTabs(ADMIN_SETTINGS_TABS, capabilities);

  if (tabs.length === 0) {
    return <div role="alert" className={styles.tabsEmpty}>利用できる設定がありません。</div>;
  }
  if (tabs.length === 1) return null;

  return (
    <nav className={styles.tabs} aria-label="システム設定">
      {tabs.map((tab) => {
        const Icon = tabIcons[tab.id];
        const active = tab.id === activeTab;
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
