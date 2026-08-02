"use client";

import Link from "next/link";
import { Building2, ExternalLink, HardHat, SquareArrowOutUpRight } from "lucide-react";
import AdminPopoverMenu from "./AdminPopoverMenu";
import styles from "./AdminNavigation.module.css";

export default function AdminAppSwitcher({ centered = false }: { centered?: boolean }) {
  return (
    <AdminPopoverMenu
      ariaLabel="アプリ切替"
      title="アプリ切替"
      icon={<SquareArrowOutUpRight size={19} />}
      centered={centered}
    >
      <>
          <p className={styles.popoverHeading}>アプリを開く</p>
          <Link className={styles.popoverLink} href="/staff" target="_blank" rel="noreferrer" role="menuitem">
            <HardHat size={17} />
            現場アプリ
            <ExternalLink size={14} />
          </Link>
          <Link className={styles.popoverLink} href="/portal" target="_blank" rel="noreferrer" role="menuitem">
            <Building2 size={17} />
            顧客アプリ
            <ExternalLink size={14} />
          </Link>
      </>
    </AdminPopoverMenu>
  );
}
