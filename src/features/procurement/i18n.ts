import { DEFAULT_LOCALE, type Locale } from "@/lib/locale";
import {
  formatStaffCount,
  formatStaffJpy,
  formatStaffTankCount,
  type LocalizedText,
} from "@/lib/staff-display";
import type { TankEntryMode } from "./lib/submitTankEntryBatch";

export const PROCUREMENT_TEXT = {
  supplyOrderTitle: { ja: "備品・資材発注", en: "Supply order" },
  supplyOrderDescription: { ja: "マスタから備品・資材を選んで発注", en: "Select supplies from the catalog and place an order." },
  loading: { ja: "読み込み中…", en: "Loading…" },
  orderItemsLoadFailure: { ja: "発注品目を読み込めませんでした。", en: "Order items could not be loaded." },
  tankDataLoadFailure: { ja: "タンク情報を読み込めませんでした。", en: "Tank data could not be loaded." },
  retry: { ja: "再試行", en: "Retry" },
  orderMasterEmpty: { ja: "発注マスタが未登録です。管理画面から登録してください。", en: "No order items are registered. Add them from the admin screen." },
  tanks: { ja: "タンク", en: "Tanks" },
  supplies: { ja: "備品", en: "Supplies" },
  cart: { ja: "カート", en: "Cart" },
  total: { ja: "合計", en: "Total" },
  placingOrder: { ja: "発注中…", en: "Placing order…" },
  purchaseTitle: { ja: "タンク購入", en: "Tank purchase" },
  registerTitle: { ja: "タンク登録", en: "Tank registration" },
  purchaseDescription: { ja: "新しいタンクの登録と費用計上を同時に行います", en: "Register new tanks and record their purchase cost." },
  registerDescription: { ja: "既存の実物タンクへIDを追加し、タンク情報だけ登録します", en: "Assign IDs to existing physical tanks and register their details." },
  purchaseSubmit: { ja: "購入登録", en: "Purchase and register" },
  registerSubmit: { ja: "登録", en: "Register" },
  toAdd: { ja: "追加予定", en: "To add" },
  prefixes: { ja: "既存プレフィックス", en: "Prefixes" },
  cost: { ja: "費用計上", en: "Cost" },
  none: { ja: "なし", en: "None" },
  tankId: { ja: "タンクID", en: "Tank ID" },
  tankIdHelp: { ja: "1本ずつ追加してからまとめて保存します", en: "Add each tank ID, then save them together." },
  add: { ja: "追加", en: "Add" },
  noTankIds: { ja: "追加予定のタンクIDはまだありません", en: "No tank IDs have been added yet." },
  registrationInfo: { ja: "登録情報", en: "Registration details" },
  registrationInfoHelp: { ja: "購入・登録どちらでも共通の情報です", en: "These details apply to both purchase and registration." },
  tankType: { ja: "タンク種別", en: "Tank type" },
  initialStatus: { ja: "初期ステータス", en: "Initial status" },
  storageLocation: { ja: "保管場所", en: "Storage location" },
  nextInspectionDue: { ja: "次回耐圧期限", en: "Next inspection due" },
  note: { ja: "メモ", en: "Note" },
  costDetails: { ja: "費用計上", en: "Cost details" },
  costDetailsHelp: { ja: "タンク購入のときだけ記録します", en: "Recorded only for tank purchases." },
  purchaseDate: { ja: "購入日", en: "Purchase date" },
  vendor: { ja: "購入先", en: "Vendor" },
  vendorPlaceholder: { ja: "仕入先名", en: "Vendor name" },
  unitCost: { ja: "単価", en: "Unit cost" },
  saving: { ja: "保存中...", en: "Saving…" },
  invalidTankId: { ja: "タンクIDが不正です", en: "Invalid tank ID" },
} satisfies Record<string, LocalizedText>;

export type ProcurementTextKey = keyof typeof PROCUREMENT_TEXT;

export function getProcurementText(
  key: ProcurementTextKey,
  locale: Locale = DEFAULT_LOCALE,
): string {
  return PROCUREMENT_TEXT[key][locale];
}

export function formatProcurementItemCount(count: number, locale: Locale): string {
  return formatStaffCount(count, locale, { ja: "品目", enSingular: "item", enPlural: "items" });
}

export function formatProcurementJpy(value: number, locale: Locale): string {
  if (locale === "ja") return `¥${new Intl.NumberFormat("ja-JP").format(value)}`;
  return formatStaffJpy(value, locale);
}

export function formatSupplyOrderConfirm(count: number, locale: Locale): string {
  return locale === "ja"
    ? `${count}品目を発注しますか？`
    : `Place an order for ${formatProcurementItemCount(count, locale)}?`;
}

export function formatSupplyOrderSuccess(count: number, total: number, locale: Locale): string {
  return locale === "ja"
    ? `${count}品目の発注を完了（合計 ${formatProcurementJpy(total, locale)}）`
    : `Placed an order for ${formatProcurementItemCount(count, locale)} (${formatProcurementJpy(total, locale)} total).`;
}

export function formatPlaceOrder(total: number, locale: Locale): string {
  return locale === "ja"
    ? `発注を確定（${formatProcurementJpy(total, locale)}）`
    : `Place order (${formatProcurementJpy(total, locale)})`;
}

export function formatQuantityButtonLabel(
  action: "increase" | "decrease",
  name: string,
  locale: Locale,
): string {
  if (locale === "ja") return `${name}の数量を${action === "increase" ? "増やす" : "減らす"}`;
  return `${action === "increase" ? "Increase" : "Decrease"} quantity for ${name}`;
}

export function getTankEntryCopy(mode: TankEntryMode, locale: Locale) {
  const isPurchase = mode === "purchase";
  return {
    title: getProcurementText(isPurchase ? "purchaseTitle" : "registerTitle", locale),
    description: getProcurementText(isPurchase ? "purchaseDescription" : "registerDescription", locale),
    submit: getProcurementText(isPurchase ? "purchaseSubmit" : "registerSubmit", locale),
  };
}

export function formatTankEntryDuplicate(tankId: string, locale: Locale): string {
  return locale === "ja" ? `${tankId} は追加済みです` : `${tankId} has already been added.`;
}

export function formatTankEntryRegistered(tankId: string, locale: Locale): string {
  return locale === "ja" ? `${tankId} は既に登録されています` : `${tankId} is already registered.`;
}

export function formatTankEntryConfirm(
  mode: TankEntryMode,
  count: number,
  totalCost: number,
  locale: Locale,
): string {
  if (locale === "ja") {
    return mode === "purchase"
      ? `${count}本を購入登録しますか？\n合計 ${formatProcurementJpy(totalCost, locale)} を計上します。`
      : `${count}本を登録しますか？`;
  }
  return mode === "purchase"
    ? `Purchase and register ${formatStaffTankCount(count, locale)}?\nRecord a total cost of ${formatProcurementJpy(totalCost, locale)}.`
    : `Register ${formatStaffTankCount(count, locale)}?`;
}

export function formatTankEntrySuccess(
  mode: TankEntryMode,
  count: number,
  totalCost: number,
  locale: Locale,
): string {
  if (locale === "ja") {
    return mode === "purchase"
      ? `${count}本を購入登録しました（${formatProcurementJpy(totalCost, locale)}）`
      : `${count}本を登録しました`;
  }
  return mode === "purchase"
    ? `Purchased and registered ${formatStaffTankCount(count, locale)} (${formatProcurementJpy(totalCost, locale)}).`
    : `Registered ${formatStaffTankCount(count, locale)}.`;
}

export function formatTankEntrySubmit(
  mode: TankEntryMode,
  count: number,
  locale: Locale,
): string {
  if (locale === "ja") return `${count}本を${getTankEntryCopy(mode, locale).submit}`;
  return `${getTankEntryCopy(mode, locale).submit} ${formatStaffTankCount(count, locale)}`;
}

const DEFAULT_TANK_TYPE_LABELS: Readonly<Record<string, LocalizedText>> = {
  "スチール 10L": { ja: "スチール 10L", en: "Steel 10L" },
  "スチール 12L": { ja: "スチール 12L", en: "Steel 12L" },
  "アルミ": { ja: "アルミ", en: "Aluminum" },
};

export function getTankTypeDisplayLabel(value: string, locale: Locale): string {
  return DEFAULT_TANK_TYPE_LABELS[value]?.[locale] ?? value;
}

export function formatRemoveTankLabel(tankId: string, locale: Locale): string {
  return locale === "ja" ? `${tankId}を削除` : `Remove ${tankId}`;
}
