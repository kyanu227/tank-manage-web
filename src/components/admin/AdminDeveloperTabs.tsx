"use client";

import Link from "next/link";
import { ShieldCheck, Workflow } from "lucide-react";
import { useAdminCapabilities } from "@/hooks/useAdminCapabilities";
import {
  ADMIN_DEVELOPER_TABS,
  getVisibleAdminSectionTabs,
} from "@/lib/admin/adminSectionTabs";
import styles from "./AdminNavigation.module.css";

export type AdminDeveloperTab = "stateDiagram" | "securityRules";

const tabIcons = { stateDiagram: Workflow, securityRules: ShieldCheck } as const;

export default function AdminDeveloperTabs({ activeTab }: { activeTab: AdminDeveloperTab }) {
  const { capabilities } = useAdminCapabilities();
  const tabs = getVisibleAdminSectionTabs(ADMIN_DEVELOPER_TABS, capabilities);
  if (tabs.length === 0) return <div role="alert" className={styles.tabsEmpty}>利用できる開発者ツールがありません。</div>;
  if (tabs.length === 1) return null;

  return (
    <nav className={styles.tabs} aria-label="開発者ツール">
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
