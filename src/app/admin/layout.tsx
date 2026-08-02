"use client";

import { useCallback, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import AdminAuthGuard from "@/components/AdminAuthGuard";
import AdminMobileHeader from "@/components/admin/AdminMobileHeader";
import AdminSidebar from "@/components/admin/AdminSidebar";
import { findAdminPage } from "@/lib/admin/adminPagesRegistry";
import styles from "@/components/admin/AdminNavigation.module.css";

function AdminAppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const mobileTriggerRef = useRef<HTMLButtonElement>(null);
  const pageLabel = findAdminPage(pathname)?.label ?? "管理画面";

  const closeMobile = useCallback((restoreFocus = false) => {
    setMobileOpen(false);
    if (restoreFocus) {
      window.requestAnimationFrame(() => mobileTriggerRef.current?.focus());
    }
  }, []);

  return (
    <div className={styles.shell}>
      <AdminMobileHeader
        ref={mobileTriggerRef}
        pageLabel={pageLabel}
        open={mobileOpen}
        onOpen={() => setMobileOpen(true)}
      />
      <AdminSidebar
        collapsed={collapsed}
        onCollapsedChange={setCollapsed}
        mobileOpen={mobileOpen}
        onMobileClose={closeMobile}
        mobileTriggerRef={mobileTriggerRef}
      />
      <div className={`${styles.mainArea} ${collapsed ? styles.mainAreaCollapsed : ""}`}>
        <main className={styles.mainContent}>{children}</main>
      </div>
    </div>
  );
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <AdminAuthGuard>
      <AdminAppShell key={pathname}>{children}</AdminAppShell>
    </AdminAuthGuard>
  );
}
