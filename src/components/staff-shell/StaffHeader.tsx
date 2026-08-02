"use client";

import Link from "next/link";
import { ChevronDown, Grab, Inbox } from "lucide-react";
import { formatPendingOrdersLabel, getStaffShellText } from "./staff-shell-i18n";
import { STAFF_OPERATIONS_HREF } from "./staff-nav-items";
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
 *
 * 受注 chip は全画面に出す（未処理受注があるときだけ）。
 * 貸出画面では操作スタイルの切替を兼ね、それ以外の画面では貸出画面への導線になる。
 */
export default function StaffHeader({
  locale,
  menuOpen,
  menuId,
  pendingOrderCount,
  opStyle,
  onToggleOpStyle,
  onToggleMenu,
  menuButtonRef,
  rootRef,
}: StaffHeaderProps) {
  const pending = pendingOrderCount ?? 0;
  const canToggleOpStyle = opStyle !== undefined && onToggleOpStyle !== undefined;
  // 受注モード中は「手動へ戻る」chip が受注 chip の位置を引き継ぐ
  const showManualChip = canToggleOpStyle && opStyle === "order";
  const showOrderChip = pending > 0 && !showManualChip;

  const orderChipBody = (
    <span className={`${styles.headerChipBody} ${styles.headerChipOrder}`}>
      <Inbox size={14} aria-hidden="true" />
      <span aria-hidden="true">
        <span className={styles.headerChipWord}>{getStaffShellText("pendingOrders", locale)} </span>
        {pending}
      </span>
    </span>
  );

  return (
    <header
      ref={rootRef}
      className={styles.header}
      data-staff-swipe-surface="header"
    >
      <div aria-hidden="true" className={styles.headerSpacer} />

      {showOrderChip && (canToggleOpStyle ? (
        <button
          type="button"
          className={styles.headerChip}
          aria-pressed={false}
          aria-label={`${getStaffShellText("switchToOrder", locale)} (${formatPendingOrdersLabel(pending, locale)})`}
          onClick={onToggleOpStyle}
          data-swipe-ignore="true"
        >
          {orderChipBody}
        </button>
      ) : (
        <Link
          href={STAFF_OPERATIONS_HREF}
          className={styles.headerChip}
          title={getStaffShellText("pendingOrdersTitle", locale)}
          aria-label={formatPendingOrdersLabel(pending, locale)}
          data-swipe-ignore="true"
        >
          {orderChipBody}
        </Link>
      ))}

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
