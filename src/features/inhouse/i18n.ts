import { DEFAULT_LOCALE, type Locale } from "@/lib/locale";
import { formatStaffTankCount, getStaffGenericErrorMessage, type LocalizedText } from "@/lib/staff-display";

export const INHOUSE_TEXT = {
  sending: { ja: "送信中…", en: "Sending…" },
  retroactiveReport: { ja: "事後報告", en: "Report past use" },
  activeTanks: { ja: "利用中タンク", en: "Tanks in use" },
  noActiveTanks: { ja: "利用中のタンクはありません", en: "No tanks are currently in use." },
  loading: { ja: "読み込み中…", en: "Loading…" },
  loadFailure: { ja: "タンク情報を読み込めませんでした。", en: "Tank data could not be loaded." },
  retry: { ja: "再試行", en: "Retry" },
  returnAll: { ja: "全て返却確定", en: "Confirm all returns" },
  uncharged: { ja: "未充填", en: "Uncharged" },
  unused: { ja: "未使用", en: "Unused" },
  bulkReturnSuccess: { ja: "一括返却が完了しました。", en: "All in-house returns were completed." },
} satisfies Record<string, LocalizedText>;

export type InHouseTextKey = keyof typeof INHOUSE_TEXT;

export function getInHouseText(
  key: InHouseTextKey,
  locale: Locale = DEFAULT_LOCALE,
): string {
  return INHOUSE_TEXT[key][locale];
}

export function formatInHouseUnregistered(tankId: string, locale: Locale): string {
  return locale === "ja" ? `${tankId} は登録されていません` : `${tankId} is not registered.`;
}

export function formatInHouseAlreadyActive(tankId: string, locale: Locale): string {
  return locale === "ja" ? `${tankId} は既に自社利用中です` : `${tankId} is already in use in-house.`;
}

export function formatInHouseReportSuccess(tankId: string, locale: Locale): string {
  return locale === "ja" ? `${tankId} の事後報告を完了しました` : `Recorded past in-house use for ${tankId}.`;
}

export function formatInHouseBulkConfirm(count: number, locale: Locale): string {
  if (locale === "ja") return `自社利用中のタンク全 ${count} 本を一括返却しますか？\n(タグ付けに応じて処理されます)`;
  return `Return all ${formatStaffTankCount(count, locale)} currently in use in-house?\nEach tank will be processed according to its return tag.`;
}

export function formatReturnTagAriaLabel(tankId: string, locale: Locale): string {
  return locale === "ja" ? `${tankId}の返却タグ` : `Return tag for ${tankId}`;
}

export function formatInHouseError(error: unknown, locale: Locale): string {
  if (locale === "ja") return `エラー: ${error instanceof Error ? error.message : String(error)}`;
  return getStaffGenericErrorMessage(locale);
}
