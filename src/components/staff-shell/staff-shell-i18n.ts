"use client";

import { DEFAULT_LOCALE, type Locale } from "@/lib/locale";
import type { LocalizedText } from "@/lib/staff-display";

/** staff shell（header / menu）の display boundary */
export const STAFF_SHELL_TEXT = {
  openMenu: { ja: "スタッフメニューを開く", en: "Open the staff menu" },
  closeMenu: { ja: "スタッフメニューを閉じる", en: "Close the staff menu" },
  menu: { ja: "スタッフメニュー", en: "Staff menu" },
  menuTitle: { ja: "STAFF MENU", en: "STAFF MENU" },
  navigation: { ja: "スタッフナビゲーション", en: "Staff navigation" },
  switchToOrder: { ja: "受注モードへ切り替え", en: "Switch to order mode" },
  switchToManual: { ja: "手動モードへ戻る", en: "Back to manual mode" },
  pendingOrders: { ja: "受注", en: "Orders" },
  manual: { ja: "手動", en: "Manual" },
  displayLanguage: { ja: "表示言語", en: "Display language" },
  localeSaving: { ja: "保存中…", en: "Saving…" },
  localeSaved: { ja: "✓ 表示言語を保存しました", en: "✓ Display language saved" },
  rankNotSet: { ja: "ランク未設定", en: "Rank not set" },
  roleNotSet: { ja: "権限未設定", en: "Role not set" },
  policyError: {
    ja: "方針を取得できないため厳格モードで動作します",
    en: "The policy could not be loaded. Strict mode is active.",
  },
  advisory: {
    ja: "自動補完モード中：不一致操作は現物確認後に正規手順へ展開し、管理者レビューまで正式集計を保留します",
    en: "Automatic recovery mode: mismatched operations are expanded into the valid sequence after physical verification and remain excluded from official totals until administrator review.",
  },
} satisfies Record<string, LocalizedText>;

export type StaffShellTextKey = keyof typeof STAFF_SHELL_TEXT;

export function getStaffShellText(
  key: StaffShellTextKey,
  locale: Locale = DEFAULT_LOCALE,
): string {
  return STAFF_SHELL_TEXT[key][locale];
}

/** menu に出すセクション名。route 群の業務上の呼び名 */
export const STAFF_SECTION_LABELS = {
  operations: { ja: "貸出・返却・充填", en: "Lend / Return / Fill" },
  inhouse: { ja: "自社管理", en: "In-house" },
  maintenance: { ja: "メンテナンス", en: "Maintenance" },
  dashboard: { ja: "ダッシュボード", en: "Dashboard" },
  procurement: { ja: "発注・タンク登録", en: "Orders / Tank entry" },
  mypage: { ja: "マイページ", en: "My page" },
} satisfies Record<string, LocalizedText>;

/** 受注件数の読み上げ用。数字だけの chip でも意味が伝わるようにする */
export function formatPendingOrdersLabel(count: number, locale: Locale): string {
  return locale === "ja"
    ? `${STAFF_SHELL_TEXT.pendingOrders.ja} ${count}`
    : `${STAFF_SHELL_TEXT.pendingOrders.en} ${count}`;
}
