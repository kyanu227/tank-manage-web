import { DEFAULT_LOCALE, type Locale } from "@/lib/locale";
import {
  formatStaffCount,
  formatStaffDate,
  formatStaffTankCount,
  type LocalizedText,
} from "@/lib/staff-display";

export const MAINTENANCE_TEXT = {
  submissionList: { ja: "送信リスト", en: "Submission list" },
  choosePrefix: { ja: "右のドラムからアルファベットを選び、", en: "Select a prefix from the list on the right," },
  enterNumber: { ja: "数字2桁を入力してください", en: "then enter the two-digit tank number." },
  damageNote: { ja: "破損内容", en: "Damage details" },
  damageNotePlaceholder: { ja: "破損内容（例: バルブ不良、タンク凹み等）", en: "Damage details (for example, faulty valve or dented tank)" },
  loading: { ja: "読み込み中…", en: "Loading…" },
  loadFailure: { ja: "タンク情報を読み込めませんでした。", en: "Tank data could not be loaded." },
  retry: { ja: "再試行", en: "Retry" },
  repairTitle: { ja: "修理完了", en: "Complete repair" },
  repairDescription: { ja: "破損/不良のタンクを空ステータスに戻します", en: "Return damaged or defective tanks to empty status." },
  awaitingRepair: { ja: "修理待ち", en: "Awaiting repair" },
  selected: { ja: "選択中", en: "Selected" },
  tapToSelect: { ja: "タップして選択", en: "Select tanks" },
  clearAll: { ja: "全解除", en: "Clear all" },
  selectAll: { ja: "全選択", en: "Select all" },
  allHandled: { ja: "すべて対応済みです", en: "All repairs are complete" },
  noRepairTanks: { ja: "修理待ちのタンクはありません", en: "No tanks are awaiting repair." },
  processing: { ja: "処理中…", en: "Processing…" },
  inspectionTitle: { ja: "耐圧検査完了", en: "Complete inspection" },
  inspectionDescription: { ja: "期限が近いタンクの耐圧検査を完了します", en: "Complete inspections for tanks approaching their due date." },
  inspectionDue: { ja: "対象", en: "Due for inspection" },
  expired: { ja: "うち期限切", en: "Expired" },
  noInspectionTanks: { ja: "対象タンクはありません", en: "No tanks require inspection" },
  noInspectionHelp: { ja: "期限が迫ったタンクが出たらここに表示されます", en: "Tanks appear here as their inspection due dates approach." },
  deadline: { ja: "期限", en: "Due" },
  inspectionExpiredMarker: { ja: "●期限切", en: "Expired" },
  inspectionDueThisMonth: { ja: "あと今月中", en: "Due this month" },
} satisfies Record<string, LocalizedText>;

export type MaintenanceTextKey = keyof typeof MAINTENANCE_TEXT;

export function getMaintenanceText(
  key: MaintenanceTextKey,
  locale: Locale = DEFAULT_LOCALE,
): string {
  return MAINTENANCE_TEXT[key][locale];
}

export function formatDamageConfirm(count: number, locale: Locale): string {
  if (locale === "ja") return `${count}本の破損報告を送信しますか？`;
  return `Submit damage reports for ${formatStaffTankCount(count, locale)}?`;
}

export function formatDamageSuccess(count: number, locale: Locale): string {
  if (locale === "ja") return `${count}本の破損報告を完了しました`;
  return `Submitted damage reports for ${formatStaffTankCount(count, locale)}.`;
}

export function formatDamageSubmit(count: number, locale: Locale): string {
  if (locale === "ja") return `${count}件の破損報告`;
  return `Report damage for ${formatStaffTankCount(count, locale)}`;
}

export function formatRepairConfirm(count: number, locale: Locale): string {
  if (locale === "ja") return `修理完了：${count}本を処理しますか？`;
  return `Complete repairs for ${formatStaffTankCount(count, locale)}?`;
}

export function formatRepairSuccess(count: number, locale: Locale): string {
  if (locale === "ja") return `${count}本の修理完了を処理しました`;
  return `Completed repairs for ${formatStaffTankCount(count, locale)}.`;
}

export function formatRepairSubmit(count: number, locale: Locale): string {
  if (locale === "ja") return `修理完了（${count}本）`;
  return `Complete repair (${formatStaffTankCount(count, locale)})`;
}

export function formatInspectionConfirm(
  count: number,
  validityYears: number,
  locale: Locale,
): string {
  if (locale === "ja") return `耐圧検査完了：${count}本を処理しますか？\n次回期限は ${validityYears}年後 に更新されます。`;
  const years = formatStaffCount(validityYears, locale, {
    ja: "年",
    enSingular: "year",
    enPlural: "years",
  });
  return `Complete inspections for ${formatStaffTankCount(count, locale)}?\nThe next due date will be set ${years} from now.`;
}

export function formatInspectionDescription(alertMonths: number, locale: Locale): string {
  if (locale === "ja") return `期限 ${alertMonths}ヶ月前〜期限切れのタンクが対象です`;
  const months = formatStaffCount(alertMonths, locale, {
    ja: "ヶ月",
    enSingular: "month",
    enPlural: "months",
  });
  return `Tanks due within ${months}, including overdue tanks, are shown.`;
}

export function formatInspectionSuccess(count: number, locale: Locale): string {
  if (locale === "ja") return `${count}本の耐圧検査完了を処理しました`;
  return `Completed inspections for ${formatStaffTankCount(count, locale)}.`;
}

export function formatInspectionSubmit(count: number, locale: Locale): string {
  if (locale === "ja") return `耐圧検査完了（${count}本）`;
  return `Complete inspection (${formatStaffTankCount(count, locale)})`;
}

export function formatInspectionRemaining(daysLeft: number, locale: Locale): string {
  if (daysLeft < 0) return getMaintenanceText("inspectionExpiredMarker", locale);
  if (daysLeft < 30) return getMaintenanceText("inspectionDueThisMonth", locale);
  if (locale === "ja") return `あと${Math.floor(daysLeft / 30)}ヶ月`;
  const months = Math.floor(daysLeft / 30);
  return `Due in ${months} ${months === 1 ? "month" : "months"}`;
}

export function formatInspectionDate(date: Date, locale: Locale): string {
  if (locale === "ja") {
    return `${getMaintenanceText("deadline", locale)}: ${date.toLocaleDateString("ja-JP", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })}`;
  }
  return `${getMaintenanceText("deadline", locale)}: ${formatStaffDate(date, locale)}`;
}

export function formatSelectTankLabel(
  tankId: string,
  selected: boolean,
  locale: Locale,
): string {
  if (locale === "ja") return selected ? `${tankId}の選択を解除` : `${tankId}を選択`;
  return selected ? `Deselect ${tankId}` : `Select ${tankId}`;
}
