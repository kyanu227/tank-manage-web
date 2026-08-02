"use client";

import { useEffect, useRef, useState } from "react";
import { LogOut } from "lucide-react";
import { auth } from "@/lib/firebase/config";
import AdminAppSwitcher from "./AdminAppSwitcher";
import AdminSettingsLauncher from "./AdminSettingsLauncher";
import styles from "./AdminNavigation.module.css";

export default function AdminSidebarFooter({ collapsed = false }: { collapsed?: boolean }) {
  const [confirmingLogout, setConfirmingLogout] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const logoutTriggerRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!confirmingLogout) return;
    cancelRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setConfirmingLogout(false);
        window.requestAnimationFrame(() => logoutTriggerRef.current?.focus());
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [confirmingLogout]);

  const closeDialog = () => {
    setConfirmingLogout(false);
    window.requestAnimationFrame(() => logoutTriggerRef.current?.focus());
  };

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await auth.signOut();
      localStorage.removeItem("staffSession");
      window.location.href = "/admin";
    } catch (error) {
      console.error("Logout error:", error);
      setLoggingOut(false);
    }
  };

  return (
    <>
      <div className={`${styles.sidebarFooter} ${collapsed ? styles.sidebarFooterCollapsed : ""}`} aria-label="管理画面の共通操作">
        <AdminAppSwitcher centered={!collapsed} />
        <AdminSettingsLauncher centered={!collapsed} />
        <button
          ref={logoutTriggerRef}
          type="button"
          className={`${styles.iconButton} ${styles.logoutButton}`}
          aria-label="ログアウト"
          aria-haspopup="dialog"
          aria-expanded={confirmingLogout}
          title="ログアウト"
          onClick={() => setConfirmingLogout(true)}
        >
          <LogOut size={19} />
        </button>
      </div>
      {confirmingLogout && (
        <div className={styles.dialogBackdrop} role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeDialog();
        }}>
          <div className={styles.dialog} role="alertdialog" aria-modal="true" aria-labelledby="admin-logout-title" aria-describedby="admin-logout-description">
            <h2 id="admin-logout-title" className={styles.dialogTitle}>ログアウトしますか？</h2>
            <p id="admin-logout-description" className={styles.dialogText}>
              管理画面のセッションを終了します。未保存の入力がある場合は失われます。
            </p>
            <div className={styles.dialogActions}>
              <button ref={cancelRef} type="button" className={`${styles.dialogButton} ${styles.dialogCancel}`} onClick={closeDialog} disabled={loggingOut}>
                キャンセル
              </button>
              <button type="button" className={`${styles.dialogButton} ${styles.dialogDestructive}`} onClick={handleLogout} disabled={loggingOut}>
                {loggingOut ? "ログアウト中…" : "ログアウト"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
