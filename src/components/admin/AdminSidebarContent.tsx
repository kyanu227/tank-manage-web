"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAdminCapabilities } from "@/hooks/useAdminCapabilities";
import {
  getResolvedAdminPageHref,
  getVisibleAdminSidebarGroups,
  isAdminSidebarPageActive,
} from "@/lib/admin/adminPagesRegistry";
import styles from "./AdminNavigation.module.css";

export function getAdminReviewBadgeLabel(reviewCount: number, collapsed: boolean): string {
  if (collapsed) return "";
  return reviewCount > 99 ? "99+" : String(reviewCount);
}

export default function AdminSidebarContent({
  collapsed = false,
  reviewCount,
  onNavigate,
}: {
  collapsed?: boolean;
  reviewCount: number | null;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const { capabilities } = useAdminCapabilities();
  const groups = getVisibleAdminSidebarGroups(capabilities);

  return (
    <nav className={styles.sidebarNav} aria-label="管理画面メニュー">
      <div className={styles.navGroups}>
        {groups.map((group) => (
          <div
            key={group.id}
            className={`${styles.navGroup} ${collapsed ? styles.navGroupCollapsed : ""}`}
          >
            {!collapsed && group.label && <div className={styles.groupLabel}>{group.label}</div>}
            {group.items.map((item) => {
              const Icon = item.icon;
              const active = isAdminSidebarPageActive(item, pathname);
              const href = getResolvedAdminPageHref(item, capabilities);
              const hasReviewBadge = item.badge === "operation-reviews"
                && reviewCount !== null
                && reviewCount > 0;
              return (
                <Link
                  key={item.id}
                  href={href}
                  className={`${styles.navItem} ${active ? styles.navItemActive : ""} ${collapsed ? styles.navItemCollapsed : ""}`}
                  aria-current={active ? "page" : undefined}
                  aria-label={collapsed ? item.label : undefined}
                  title={collapsed ? item.label : undefined}
                  onClick={onNavigate}
                >
                  <Icon size={19} aria-hidden="true" />
                  {!collapsed && <span className={styles.navLabel}>{item.label}</span>}
                  {hasReviewBadge && (
                    <span
                      className={`${styles.badge} ${collapsed ? styles.badgeCollapsed : ""}`}
                      aria-label={`承認待ち${reviewCount}件`}
                    >
                      {getAdminReviewBadgeLabel(reviewCount, collapsed)}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </div>
    </nav>
  );
}
