import { DEFAULT_LOCALE, type Locale } from "@/lib/locale";
import {
  formatStaffCount,
  formatStaffTankCount,
  getStaffLocationLabel,
  type LocalizedText,
} from "@/lib/staff-display";
import {
  getLegacyTankActionLabel,
  getLegacyTankStatusLabel,
} from "@/lib/tank-action-status-labels";
import { coerceTankLogActionCode } from "@/lib/tank-action-status-codes";

export const DASHBOARD_TEXT = {
  dashboard: { ja: "ダッシュボード", en: "Dashboard" },
  dashboardSubtitle: { ja: "ステータス別内訳 / 業務状況 / 操作ログ", en: "Status breakdown / Operations / Activity log" },
  loading: { ja: "読み込み中...", en: "Loading..." },
  loadFailure: { ja: "ダッシュボードを読み込めませんでした。", en: "The dashboard could not be loaded." },
  retry: { ja: "再試行", en: "Retry" },
  statusBreakdown: { ja: "ステータス別内訳", en: "Status breakdown" },
  totalTanks: { ja: "総本数", en: "Total tanks" },
  noTanks: { ja: "タンクが未登録です", en: "No tanks are registered." },
  operations: { ja: "業務状況", en: "Operations" },
  byCustomer: { ja: "貸出先別", en: "By customer" },
  noLoans: { ja: "貸出中のタンクはありません", en: "No tanks are currently lent." },
  lent: { ja: "貸出", en: "Lent" },
  unreturned: { ja: "未返却", en: "Unreturned" },
  todayOperations: { ja: "今日の操作", en: "Today's operations" },
  noTodayOperations: { ja: "本日の操作はまだありません", en: "There are no operations today." },
  unfilledReports: { ja: "顧客未充填報告", en: "Customer unfilled reports" },
  noUnfilledReports: { ja: "顧客未充填報告はありません", en: "There are no customer unfilled reports." },
  recentLogs: { ja: "最近の操作ログ", en: "Recent activity log" },
  newestFirst: { ja: "新しい順", en: "Newest first" },
  oldestFirst: { ja: "古い順", en: "Oldest first" },
  newestToOldest: { ja: "新しい順 → 古い順に切替", en: "Switch from newest to oldest" },
  oldestToNewest: { ja: "古い順 → 新しい順に切替", en: "Switch from oldest to newest" },
  done: { ja: "完了", en: "Done" },
  edit: { ja: "編集", en: "Edit" },
  selected: { ja: "選択", en: "Selected" },
  selectAll: { ja: "全選択", en: "Select all" },
  clearSelection: { ja: "選択解除", en: "Clear selection" },
  changeCustomer: { ja: "貸出先変更", en: "Change customer" },
  bulkVoid: { ja: "一括取消", en: "Void selected" },
  noLogs: { ja: "ログがありません", en: "No logs are available." },
  select: { ja: "選択", en: "Select" },
  unavailable: { ja: "期限外または対象外", en: "Unavailable" },
  changeId: { ja: "ID変更", en: "Change ID" },
  void: { ja: "取消", en: "Void" },
  history: { ja: "履歴", en: "History" },
  historyLoading: { ja: "履歴を読み込み中...", en: "Loading history..." },
  noHistory: { ja: "履歴がありません", en: "No history is available." },
  tankIdChange: { ja: "タンクID変更", en: "Change tank ID" },
  tankId: { ja: "タンクID", en: "Tank ID" },
  tankIdChangeHelp: { ja: "タンクIDだけを変更します。操作種別・貸出先・メモなどは変更しません。", en: "Only the tank ID will change. The action, customer, note, and other details remain unchanged." },
  editReason: { ja: "編集理由", en: "Reason for change" },
  saving: { ja: "保存中...", en: "Saving..." },
  logVoid: { ja: "ログ取消", en: "Void log" },
  voidReason: { ja: "取消理由", en: "Reason for voiding" },
  voiding: { ja: "取消中...", en: "Voiding..." },
  customer: { ja: "貸出先", en: "Customer" },
  changeReason: { ja: "変更理由", en: "Reason for change" },
  updating: { ja: "更新中...", en: "Updating..." },
  close: { ja: "close", en: "Close" },
  customerNotSet: { ja: "顧客未設定", en: "Customer not set" },
  portalSource: { ja: "顧客ポータル", en: "Customer portal" },
  appSource: { ja: "顧客アプリ", en: "Customer app" },
  sourceNotSet: { ja: "source未設定", en: "Source not set" },
  recorded: { ja: "記録済み", en: "Recorded" },
  pending: { ja: "pending", en: "Pending" },
  pendingLink: { ja: "pending_link", en: "Awaiting customer link" },
  statusNotSet: { ja: "status未設定", en: "Status not set" },
  active: { ja: "有効", en: "Active" },
  superseded: { ja: "置換済", en: "Superseded" },
  voided: { ja: "取消済", en: "Voided" },
  unknown: { ja: "不明", en: "Unknown" },
  unknownAction: { ja: "不明", en: "Unknown action" },
  unknownStatus: { ja: "不明", en: "Unknown status" },
  unknownSource: { ja: "不明", en: "Unknown source" },
  unknownReportStatus: { ja: "不明", en: "Unknown report status" },
  unknownLogKind: { ja: "不明", en: "Unknown log type" },
  unknownLocation: { ja: "不明", en: "Unknown location" },
  tankLog: { ja: "タンク操作", en: "Tank operation" },
  orderLog: { ja: "資材発注", en: "Supply order" },
  procurementLog: { ja: "タンク調達", en: "Tank procurement" },
  missingDestination: { ja: "貸出先が選択されていません", en: "No customer is selected." },
  correctionFailure: { ja: "編集エラー", en: "The log could not be updated." },
  voidFailure: { ja: "取消エラー", en: "The log could not be voided." },
  historyFailure: { ja: "履歴取得エラー", en: "History could not be loaded." },
  transitionPlanMissing: { ja: "transitionPlanを確認できないログは訂正できません", en: "This log cannot be corrected because its transition plan is unavailable." },
  recoveryCorrectionBlocked: { ja: "自動補完ログは取消後に正しい操作を再実行してください", en: "Void this recovery log, then run the correct operation again." },
  reviewCorrectionBlocked: { ja: "集計レビュー対象のログは直接訂正できません", en: "Logs under review cannot be corrected directly." },
  notTankLog: { ja: "タンク操作ログではありません", en: "This is not a tank-operation log." },
  inactiveLog: { ja: "有効なログではありません", en: "This log is not active." },
  missingCreatedAt: { ja: "作成日時が取得できず期限判定できません", en: "The edit deadline cannot be checked because the creation time is unavailable." },
  editExpired: { ja: "一般スタッフの編集可能期限を超過しています", en: "The editing window for staff has expired." },
  saveInProgress: { ja: "保存中です", en: "A save is in progress." },
  editTargetMissing: { ja: "編集対象を確認できません", en: "The log to edit could not be identified." },
  selectTankId: { ja: "タンクIDを選択してください", en: "Select a tank ID." },
  sameTankId: { ja: "変更前と同じタンクIDです。別のタンクIDを選択してください", en: "Select a tank ID different from the current one." },
  reasonFiveChars: { ja: "理由を5文字以上入力してください", en: "Enter a reason of at least five characters." },
  voidReasonFiveChars: { ja: "取消理由を5文字以上入力してください", en: "Enter a void reason of at least five characters." },
  noCustomerOptions: { ja: "有効な貸出先候補がありません。顧客マスタに有効な貸出先があるか確認してください。", en: "No active customers are available. Check the customer master." },
  inhouseDestinationMissing: { ja: "自社利用の変更先を確認できません。選択を解除して再度選び直してください。", en: "The in-house destination is unavailable. Clear the selection and try again." },
  incompatibleLocationSelection: { ja: "貸出先変更は貸出ログだけ、または自社利用ログだけを選択した場合に使えます。返却・充填・混在選択では使えません。", en: "Customer changes require only lend logs or only in-house-use logs. Returns, fills, and mixed selections are not supported." },
} satisfies Record<string, LocalizedText>;

export type DashboardTextKey = keyof typeof DASHBOARD_TEXT;

export function getDashboardText(key: DashboardTextKey, locale: Locale = DEFAULT_LOCALE): string {
  return DASHBOARD_TEXT[key][locale];
}

export function formatDashboardItemCount(count: number, locale: Locale): string {
  return formatStaffCount(count, locale, { ja: "件", enSingular: "item", enPlural: "items" });
}

export function formatDashboardActiveLogs(count: number, locale: Locale): string {
  if (locale === "ja") return `直近 ${count} 件（active）`;
  return `${count} active ${count === 1 ? "log" : "logs"}`;
}

export function formatDashboardCustomerCount(count: number, locale: Locale): string {
  return formatStaffCount(count, locale, { ja: "件", enSingular: "customer", enPlural: "customers" });
}

export function formatDashboardOperationCount(count: number, locale: Locale): string {
  return formatStaffCount(count, locale, { ja: "件", enSingular: "operation", enPlural: "operations" });
}

export function formatDashboardReportCount(count: number, locale: Locale): string {
  return formatStaffCount(count, locale, { ja: "件", enSingular: "report", enPlural: "reports" });
}

export function formatDashboardSelectedCount(count: number, locale: Locale): string {
  if (locale === "ja") return `選択 ${count} 件`;
  return `Selected ${formatDashboardItemCount(count, locale)}`;
}

export function formatDashboardStaffName(name: string, locale: Locale): string {
  return locale === "ja" ? `${name} さん` : name;
}

export function formatBulkLocationDescription(count: number, locale: Locale): string {
  if (locale === "ja") return `選択中 ${count} 件の貸出先をまとめて変更します。`;
  return `Change the customer for ${formatDashboardItemCount(count, locale)}.`;
}

export function formatBulkVoidDescription(count: number, locale: Locale): string {
  if (locale === "ja") return `選択中 ${count} 件のログを取り消します。`;
  return `Void ${formatDashboardItemCount(count, locale)}.`;
}

export function formatDashboardUpdateSuccess(count: number, locale: Locale): string {
  if (locale === "ja") return `${count}件の貸出先を更新しました。`;
  return `Updated the customer for ${formatDashboardItemCount(count, locale)}.`;
}

export function formatDashboardVoidSuccess(count: number, locale: Locale): string {
  if (locale === "ja") return `${count}件を取り消しました。`;
  return `Voided ${formatDashboardItemCount(count, locale)}.`;
}

export function formatDashboardPartialFailure(
  kind: "location" | "void",
  failures: readonly string[],
  locale: Locale,
): string {
  if (locale === "ja" && kind === "location") return `貸出先変更は一部失敗しました。\n${failures.join("\n")}`;
  if (locale === "ja") return `一括取消は一部失敗しました。\n${failures.join("\n")}`;
  return kind === "location"
    ? "Some customer changes failed. Refresh and try again."
    : "Some logs could not be voided. Refresh and try again.";
}

export function formatDashboardTankCount(count: number, locale: Locale): string {
  return formatStaffTankCount(count, locale);
}

export function formatDashboardDateTime(date: Date, locale: Locale): string {
  if (locale === "ja") {
    return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function formatDashboardLogKind(value: string | null | undefined, locale: Locale): string {
  if (locale === "ja") return value || "-";
  if (value === "tank") return getDashboardText("tankLog", locale);
  if (value === "order") return getDashboardText("orderLog", locale);
  if (value === "procurement") return getDashboardText("procurementLog", locale);
  return getDashboardText("unknownLogKind", locale);
}

export function formatDashboardTankId(
  value: string,
  logKind: string | null | undefined,
  locale: Locale,
): string {
  if (logKind !== "procurement") return value;
  const summary = locale === "ja" ? null : value.match(/^(.*) 他(\d+)本$/u);
  return summary ? `${summary[1]} +${summary[2]} more` : value;
}

export function formatDashboardActionLabel(
  value: string | null | undefined,
  locale: Locale,
): string {
  const knownLabel = getLegacyTankActionLabel(value, locale);
  if (knownLabel) return knownLabel;
  if (locale === "ja") return value || getDashboardText("unknownAction", locale);
  return getDashboardText("unknownAction", locale);
}

export function formatDashboardTankStatusLabel(
  value: string | null | undefined,
  locale: Locale,
): string {
  const knownLabel = getLegacyTankStatusLabel(value, locale);
  if (knownLabel) return knownLabel;
  if (locale === "ja") return value || getDashboardText("unknownStatus", locale);
  return getDashboardText("unknownStatus", locale);
}

export function formatDashboardReportSource(
  value: string | null | undefined,
  locale: Locale,
): string {
  if (value === "customer_portal") return getDashboardText("portalSource", locale);
  if (value === "customer_app") return getDashboardText("appSource", locale);
  if (!value) return getDashboardText("sourceNotSet", locale);
  if (locale === "ja") return value;
  return getDashboardText("unknownSource", locale);
}

export function formatDashboardReportStatus(
  value: string | null | undefined,
  locale: Locale,
): string {
  if (value === "completed") return getDashboardText("recorded", locale);
  if (value === "pending") return getDashboardText("pending", locale);
  if (value === "pending_link") return getDashboardText("pendingLink", locale);
  if (!value) return getDashboardText("statusNotSet", locale);
  if (locale === "ja") return value;
  return getDashboardText("unknownReportStatus", locale);
}

export function formatDashboardLocationOption(
  location: string,
  isSystemLocation: boolean,
  locale: Locale,
): string {
  return isSystemLocation ? getStaffLocationLabel(location, locale) : location;
}

export function formatDashboardLogLocation(
  input: Readonly<{
    location?: string | null;
    customerId?: string | null;
    customerName?: string | null;
    action?: string | null;
    transitionAction?: string | null;
  }>,
  locale: Locale,
): string {
  const location = input.location ?? "";
  if (locale === "ja") return location || "-";
  const actionCode = coerceTankLogActionCode(
    input.action,
    input.transitionAction,
  );
  const isCustomerAction = actionCode === "lend"
    || actionCode === "order_lend"
    || actionCode === "carry_over";
  const isCustomerLocation = actionCode
    ? isCustomerAction
    : Boolean(input.customerId?.trim() || input.customerName?.trim());
  if (isCustomerLocation) {
    return location || getStaffLocationLabel("", locale);
  }
  const systemLabel = getStaffLocationLabel(location, locale);
  if (!location || systemLabel !== location) return systemLabel;
  return getDashboardText("unknownLocation", locale);
}
