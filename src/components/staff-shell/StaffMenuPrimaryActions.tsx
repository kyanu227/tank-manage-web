"use client";

import Link from "next/link";
import type { Locale } from "@/lib/locale";
import {
  STAFF_INHOUSE_HREF,
  STAFF_INHOUSE_ICON,
  STAFF_OPERATIONS_HREF,
  STAFF_OPERATIONS_ICON,
} from "./staff-nav-items";
import { STAFF_SECTION_LABELS } from "./staff-shell-i18n";
import styles from "./StaffShell.module.css";

interface StaffMenuPrimaryActionsProps {
  readonly locale: Locale;
  readonly activePrimary: "operations" | "inhouse" | null;
  readonly pendingOrderCount: number | null;
  readonly onNavigate: () => void;
}

/**
 * menu 下端の主要操作。右手の親指に最も近い位置に固定し、僅かに沈んだ面に置く。
 *
 * 強調は塗りの重さと寸法だけで作る（塗り潰し 56px > 輪郭 50px > 素の行 44px）。
 * glow は使わず、影は 1 本だけ。
 * 受注件数は操作ボタン内の chip へ寄せ、ヘッダー通知との役割重複を作らない。
 */
export default function StaffMenuPrimaryActions({
  locale,
  activePrimary,
  pendingOrderCount,
  onNavigate,
}: StaffMenuPrimaryActionsProps) {
  const OperationsIcon = STAFF_OPERATIONS_ICON;
  const InhouseIcon = STAFF_INHOUSE_ICON;
  const pending = pendingOrderCount ?? 0;

  return (
    <div className={styles.primary}>
      <Link
        href={STAFF_OPERATIONS_HREF}
        className={styles.primaryStrong}
        aria-current={activePrimary === "operations" ? "page" : undefined}
        onClick={onNavigate}
      >
        <OperationsIcon size={19} aria-hidden="true" />
        <span className={styles.primaryStrongLabel}>
          {STAFF_SECTION_LABELS.operations[locale]}
        </span>
        {pending > 0 && <span className={styles.primaryCount}>{pending}</span>}
      </Link>

      <Link
        href={STAFF_INHOUSE_HREF}
        className={styles.primarySoft}
        aria-current={activePrimary === "inhouse" ? "page" : undefined}
        onClick={onNavigate}
      >
        <span className={styles.primarySoftIcon}>
          <InhouseIcon size={18} aria-hidden="true" />
        </span>
        {STAFF_SECTION_LABELS.inhouse[locale]}
      </Link>
    </div>
  );
}
