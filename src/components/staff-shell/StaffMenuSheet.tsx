"use client";

import { ChevronDown } from "lucide-react";
import StaffLocaleSelect from "./StaffLocaleSelect";
import StaffMenuAccount from "./StaffMenuAccount";
import StaffMenuNav from "./StaffMenuNav";
import StaffMenuPrimaryActions from "./StaffMenuPrimaryActions";
import { getStaffShellText } from "./staff-shell-i18n";
import type { StaffMenuSheetProps } from "./staff-shell-types";
import styles from "./StaffShell.module.css";

/**
 * 右寄せトップシート。
 *
 * ヘッダーがそのまま右上から下へ伸びた一枚の面として扱う。
 * - 画面の上端と右端に密着し、角丸は下2辺のみ
 * - Chevron は開閉で位置が動かない（この sheet 上部 56px 行に同座標で再出現する）
 * - navigation だけがスクロールし、primary zone は下端に残る
 * - data-staff-swipe-surface は gesture coordinator の起点マーカー
 */
export default function StaffMenuSheet({
  open,
  id,
  locale,
  account,
  navItems,
  activePrimary,
  pendingOrderCount,
  localeValue,
  localeStatus,
  localeErrorMessage,
  onLocaleChange,
  onClose,
  onNavigate,
  sheetRef,
  closeButtonRef,
  backdropRef,
  scrollRegionRef,
}: StaffMenuSheetProps) {
  return (
    <>
      <button
        ref={backdropRef}
        type="button"
        className={styles.backdrop}
        data-open={open}
        data-staff-swipe-surface="menu-backdrop"
        tabIndex={-1}
        aria-hidden="true"
        onClick={onClose}
      />

      <div
        ref={sheetRef}
        id={id}
        className={styles.sheet}
        data-open={open}
        data-staff-swipe-surface="menu"
        role="dialog"
        aria-modal={open || undefined}
        aria-label={getStaffShellText("menu", locale)}
        aria-hidden={!open}
        inert={!open}
      >
        <div className={styles.sheetTop}>
          <div className={styles.sheetTopRow}>
            <span className={styles.sheetTitle}>{getStaffShellText("menuTitle", locale)}</span>
            <button
              ref={closeButtonRef}
              type="button"
              className={styles.sheetClose}
              aria-label={getStaffShellText("closeMenu", locale)}
              onClick={onClose}
              data-swipe-ignore="true"
            >
              <span className={`${styles.chevron} ${styles.chevronUp}`}>
                <ChevronDown size={20} aria-hidden="true" />
              </span>
            </button>
          </div>
        </div>

        <div className={styles.account}>
          {account && <StaffMenuAccount account={account} locale={locale} />}
          <StaffLocaleSelect
            value={localeValue}
            uiLocale={locale}
            status={localeStatus}
            errorMessage={localeErrorMessage}
            onChange={onLocaleChange}
          />
        </div>

        {/* 遷移先と主要操作を1つの箱として束ねる（線ではなく影で囲いを示す） */}
        <div className={styles.menuCard}>
          <StaffMenuNav
            items={navItems}
            locale={locale}
            onNavigate={onNavigate}
            navRef={scrollRegionRef}
          />

          <StaffMenuPrimaryActions
            locale={locale}
            activePrimary={activePrimary}
            pendingOrderCount={pendingOrderCount}
            onNavigate={onNavigate}
          />
        </div>

        {/* 上スワイプで閉じられることの手がかり。箱の外に置く */}
        <div className={styles.grabber} aria-hidden="true" />
      </div>
    </>
  );
}
