"use client";

import { forwardRef } from "react";
import { Menu } from "lucide-react";
import styles from "./AdminNavigation.module.css";

const AdminMobileHeader = forwardRef<HTMLButtonElement, {
  pageLabel: string;
  open: boolean;
  onOpen: () => void;
}>(({ pageLabel, open, onOpen }, ref) => (
  <header className={styles.mobileHeader}>
    <button
      ref={ref}
      type="button"
      className={styles.mobileMenuButton}
      aria-label="管理メニューを開く"
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={onOpen}
    >
      <Menu size={20} />
    </button>
    <div className={styles.mobileTitle}>{pageLabel}</div>
  </header>
));

AdminMobileHeader.displayName = "AdminMobileHeader";

export default AdminMobileHeader;
