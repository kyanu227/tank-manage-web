"use client";

import { ChevronDown, Grab, Inbox } from "lucide-react";
import { formatPendingOrdersLabel, getStaffShellText } from "./staff-shell-i18n";
import type { StaffHeaderProps } from "./staff-shell-types";
import styles from "./StaffShell.module.css";

/**
 * staff header。
 *
 * - ハンバーガーを持たない。右端の Chevron だけが menu の入口
 * - コンテンツ行は 56px 固定で、320px でも折り返さない
 * - 硬い 1px 境界線を持たない（奥行きは StaffShell の 10px fade が担う）
 * - 左側の余白は下スワイプの起点。ここに操作要素を置かない
 * - data-staff-swipe-surface / data-swipe-ignore は gesture coordinator 用のマーカー
 */
export default function StaffHeader({
  locale,
  menuOpen,
  menuId,
  scrolled,
  pendingOrderCount,
  opStyle,
  onToggleOpStyle,
  onToggleMenu,
  menuButtonRef,
  rootRef,
}: StaffHeaderProps) {
  const pending = pendingOrderCount ?? 0;
  // 手動モードで未処理受注があるときだけ、受注モードへ誘導する chip を出す
  const showOrderChip = opStyle === "manual" && pending > 0;
  // 受注モード中は、手動へ戻る chip を出す
  const showManualChip = opStyle === "order";

  return (
    <header
      ref={rootRef}
      className={styles.header}
      data-staff-swipe-surface="header"
      data-scrolled={scrolled}
    >
      <div aria-hidden="true" className={styles.headerSpacer} />

      {showOrderChip && (
        <button
          type="button"
          className={styles.headerChip}
          aria-pressed={false}
          aria-label={`${getStaffShellText("switchToOrder", locale)} (${formatPendingOrdersLabel(pending, locale)})`}
          onClick={onToggleOpStyle}
          data-swipe-ignore="true"
        >
          <span className={`${styles.headerChipBody} ${styles.headerChipOrder}`}>
            <Inbox size={14} aria-hidden="true" />
            <PendingChipLabel count={pending} label={getStaffShellText("pendingOrders", locale)} />
          </span>
        </button>
      )}

      {showManualChip && (
        <button
          type="button"
          className={styles.headerChip}
          aria-pressed
          aria-label={getStaffShellText("switchToManual", locale)}
          onClick={onToggleOpStyle}
          data-swipe-ignore="true"
        >
          <span className={`${styles.headerChipBody} ${styles.headerChipManual}`}>
            <Grab size={14} aria-hidden="true" />
            {getStaffShellText("manual", locale)}
          </span>
        </button>
      )}

      <button
        ref={menuButtonRef}
        type="button"
        className={styles.menuTrigger}
        aria-controls={menuId}
        aria-expanded={menuOpen}
        aria-label={getStaffShellText(menuOpen ? "closeMenu" : "openMenu", locale)}
        onClick={onToggleMenu}
        data-swipe-ignore="true"
      >
        <span className={`${styles.chevron}${menuOpen ? ` ${styles.chevronUp}` : ""}`}>
          <ChevronDown size={20} aria-hidden="true" />
        </span>
      </button>
    </header>
  );
}

/** 320px 未満では件数だけにして header を1行に保つ。読み上げは aria-label 側で担保する */
function PendingChipLabel({ count, label }: { count: number; label: string }) {
  return (
    <span aria-hidden="true">
      <span className={styles.headerChipWord}>{label} </span>
      {count}
    </span>
  );
}
