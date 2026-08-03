"use client";

import type { LucideIcon } from "lucide-react";
import type { Locale } from "@/lib/locale";

/**
 * staff shell の presentational contract。
 *
 * ここに置くのは「表示に必要な形」だけで、取得方法・保存方法は含めない。
 * state と behavior は composition 層（staff layout）が接続する。
 */

/** menu が扱うナビゲーション単位。route 群をまとめた業務上のセクション */
export type StaffMenuSection =
  | "operations"
  | "inhouse"
  | "maintenance"
  | "dashboard"
  | "procurement"
  | "mypage";

/** ページ全体の縦スクロールを許すかどうか。docs/design §5 の単一 policy */
export type StaffViewportMode = "allowed" | "locked";

/** menu 上部に出すログイン中スタッフの表示情報（既存 staffSession から作る） */
export interface StaffAccountView {
  readonly name: string;
  readonly email?: string;
  readonly role?: string;
  readonly rank?: string;
}

/** 言語設定の保存状態 */
export type StaffLocaleStatus = "idle" | "saving" | "saved" | "error";

/** menu の navigation zone に並ぶ遷移先1件 */
export interface StaffNavItemView {
  readonly section: StaffMenuSection;
  readonly href: string;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly active: boolean;
}

export interface StaffHeaderProps {
  readonly locale: Locale;
  readonly menuOpen: boolean;
  /** aria-controls が指す menu sheet の id */
  readonly menuId: string;
  readonly pendingOrderCount: number | null;
  /** 手動／受注の切替を出す画面でのみ渡す（現行は貸出画面のみ） */
  readonly opStyle?: "manual" | "order";
  readonly onToggleOpStyle?: () => void;
  readonly onToggleMenu: () => void;
  readonly menuButtonRef?: React.Ref<HTMLButtonElement>;
  readonly rootRef?: React.Ref<HTMLElement>;
}

export interface StaffMenuSheetProps {
  readonly open: boolean;
  readonly id: string;
  readonly locale: Locale;
  readonly account: StaffAccountView | null;
  readonly navItems: readonly StaffNavItemView[];
  /** primary zone のどちらが現在地か */
  readonly activePrimary: "operations" | "inhouse" | null;
  readonly pendingOrderCount: number | null;
  readonly localeValue: Locale;
  readonly localeStatus: StaffLocaleStatus;
  readonly localeErrorMessage?: string;
  readonly onLocaleChange: (locale: Locale) => void;
  /**
   * `restoreFocus` はキーボード起点の close（close ボタンの Enter・Space）でのみ true。
   * close ボタンは閉じた直後に inert になるため、返さないとフォーカスが行き場を失う。
   * ポインター・ジェスチャー起点では渡さない（プログラム的な focus がリングを出すため）。
   */
  readonly onClose: (options?: { restoreFocus?: boolean }) => void;
  /** ナビゲーション選択時に menu を閉じるための通知 */
  readonly onNavigate: () => void;
  readonly sheetRef?: React.Ref<HTMLDivElement>;
  readonly closeButtonRef?: React.Ref<HTMLButtonElement>;
  readonly backdropRef?: React.Ref<HTMLButtonElement>;
  /** 内部スクロール領域。close gesture の scroll chaining 判定に使う */
  readonly scrollRegionRef?: React.Ref<HTMLElement>;
}

export interface StaffShellProps {
  readonly locale: Locale;
  readonly viewportMode: StaffViewportMode;
  readonly scrolled: boolean;
  readonly header: React.ReactNode;
  readonly banner?: React.ReactNode;
  readonly menu: React.ReactNode;
  readonly children: React.ReactNode;
  readonly mainRef?: React.Ref<HTMLElement>;
}
