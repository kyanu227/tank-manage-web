"use client";

import { useEffect, useState, type RefObject } from "react";
import { ChevronLeft, X } from "lucide-react";
import { useAdminCapabilities } from "@/hooks/useAdminCapabilities";
import { hasAdminCapability } from "@/lib/admin/adminCapabilities";
import { getPendingOperationReviewCount } from "@/lib/firebase/operation-review-service";
import { useTankDataRevision } from "@/hooks/useTankDataRevision";
import AdminSidebarContent from "./AdminSidebarContent";
import AdminSidebarFooter from "./AdminSidebarFooter";
import styles from "./AdminNavigation.module.css";

export default function AdminSidebar({
  collapsed,
  onCollapsedChange,
  mobileOpen,
  onMobileClose,
  mobileTriggerRef,
}: {
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  mobileOpen: boolean;
  onMobileClose: (restoreFocus?: boolean) => void;
  mobileTriggerRef: RefObject<HTMLButtonElement | null>;
}) {
  const { capabilities } = useAdminCapabilities();
  const canReview = hasAdminCapability(capabilities, "reviews.view");
  const revision = useTankDataRevision();
  const [reviewCount, setReviewCount] = useState<number | null>(null);

  useEffect(() => {
    if (!canReview) return;
    let cancelled = false;
    getPendingOperationReviewCount()
      .then((count) => {
        if (!cancelled) setReviewCount(count);
      })
      .catch((error) => {
        console.error("例外操作レビュー件数取得エラー:", error);
        if (!cancelled) setReviewCount(null);
      });
    return () => {
      cancelled = true;
    };
  }, [canReview, revision]);

  useEffect(() => {
    if (!mobileOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onMobileClose(true);
    };
    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [mobileOpen, onMobileClose]);

  const closeMobile = (restoreFocus = true) => {
    onMobileClose(restoreFocus);
    if (restoreFocus) window.requestAnimationFrame(() => mobileTriggerRef.current?.focus());
  };
  const visibleReviewCount = canReview ? reviewCount : null;

  return (
    <>
      <aside className={`${styles.desktopSidebar} ${collapsed ? styles.desktopSidebarCollapsed : ""}`}>
        <div className={styles.sidebarHeader}>
          {!collapsed && <span className={styles.brand}>管理画面</span>}
          <button
            type="button"
            className={styles.collapseButton}
            onClick={() => onCollapsedChange(!collapsed)}
            aria-label={collapsed ? "サイドバーを展開" : "サイドバーを縮小"}
            title={collapsed ? "サイドバーを展開" : "サイドバーを縮小"}
          >
            <ChevronLeft size={18} style={{ transform: collapsed ? "rotate(180deg)" : undefined }} />
          </button>
        </div>
        <AdminSidebarContent collapsed={collapsed} reviewCount={visibleReviewCount} />
        <AdminSidebarFooter collapsed={collapsed} />
      </aside>

      {mobileOpen && <div className={styles.mobileOverlay} onClick={() => closeMobile(true)} aria-hidden="true" />}
      {mobileOpen && <aside
        className={`${styles.mobileDrawer} ${styles.mobileDrawerOpen}`}
        role="dialog"
        aria-modal="true"
        aria-label="管理メニュー"
      >
        <div className={styles.drawerHeader}>
          <span className={styles.brand}>管理画面</span>
          <button type="button" className={styles.drawerClose} aria-label="管理メニューを閉じる" onClick={() => closeMobile(true)}>
            <X size={19} />
          </button>
        </div>
        <AdminSidebarContent reviewCount={visibleReviewCount} onNavigate={() => closeMobile(true)} />
        <AdminSidebarFooter />
      </aside>}
    </>
  );
}
