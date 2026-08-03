import { DEFAULT_LOCALE, type Locale } from "@/lib/locale";
import { formatMessage, type MessageParams } from "@/lib/operation-messages";
import type { LocalizedText } from "@/lib/staff-display";

export type StaffOperationTextKey = keyof typeof STAFF_OPERATION_TEXT;

export const STAFF_OPERATION_TEXT = {
  unknownStatus: { ja: "不明", en: "Unknown status" },
  destinationLookupFailure: {
    ja: "貸出先を取得できませんでした。貸出先を選び直してください。",
    en: "The customer could not be found. Select the customer again.",
  },
  tankNumberInput: { ja: "タンク番号", en: "Tank number" },
  back: { ja: "戻る", en: "Back" },
  operationMode: { ja: "操作モード", en: "Operation mode" },
  operationDataLoading: { ja: "タンク情報を読み込み中", en: "Loading tank data" },
  operationDataLoadFailure: {
    ja: "操作に必要なデータを読み込めませんでした。",
    en: "The data required for this operation could not be loaded.",
  },
  queue: { ja: "送信リスト", en: "Submission list" },
  /* 件数は monospace accent、単位は muted で別要素に置くため、数と単位を分ける */
  queueUnitOne: { ja: "件", en: "tank" },
  queueUnitMany: { ja: "件", en: "tanks" },
  clearQueue: { ja: "全削除", en: "Clear all" },
  clearQueueArmed: { ja: "全削除する？", en: "Clear all?" },
  clearQueueAria: {
    ja: "送信リストを全削除（もう一度タップで確定）",
    en: "Clear the submission list (tap again to confirm)",
  },
  scannedList: { ja: "スキャンリスト", en: "Scanned tanks" },
  choosePrefix: {
    ja: "右側のリストからアルファベットを選び、",
    en: "Select a prefix from the list on the right,",
  },
  enterTankNumber: {
    ja: "タンクの数字を入力してください",
    en: "then enter the tank number.",
  },
  currentStatus: { ja: "現在: {status}", en: "Current: {status}" },
  recoveryRequired: {
    ja: "自動補完確認が必要",
    en: "Physical verification required",
  },
  /* 行内チップ。長い説明文は同じ行の状態テキストが引き続き担う */
  recoveryChip: { ja: "要復旧", en: "Verify" },
  blockedChip: { ja: "送信対象外", en: "Excluded" },
  prefixNotSelected: { ja: "プレフィックスを選択", en: "Select a prefix" },
  destinationLabel: { ja: "貸出先", en: "Destination" },
  selectDestination: {
    ja: "貸出先を選択してください",
    en: "Please select a destination",
  },
  selectCustomerAndRun: {
    ja: "貸出先を選択して実行...",
    en: "Select a customer and run...",
  },
  noActiveCustomers: {
    ja: "利用可能な貸出先がありません。",
    en: "No active customers are available.",
  },
  okInput: { ja: "OK入力", en: "Enter OK" },
  removeTank: { ja: "{tankId}を削除", en: "Remove {tankId}" },
  executeOperation: {
    ja: "{countLabel}の{operation}を実行",
    en: "Run {operation} for {countLabel}",
  },
  invalidTankId: { ja: "タンクIDが不正です", en: "Invalid tank ID" },
  unregisteredTank: { ja: "未登録タンク", en: "Tank is not registered" },
  invalidTankStatus: { ja: "タンク状態が不正です", en: "Tank status is invalid" },
  policyLoading: { ja: "操作方針を確認中です", en: "Checking the operation policy" },
  operationNotAllowed: { ja: "{status} は不可", en: "Not allowed from {status}" },
  customerRequired: { ja: "貸出先を選択してください。", en: "Select a customer." },
  operationFailure: {
    ja: "操作を完了できませんでした。問題が続く場合は管理者に連絡してください。",
    en: "The operation could not be completed. Contact an administrator if the problem persists.",
  },
  approveConfirm: {
    ja: "{customerName} の受注を承認しますか？",
    en: "Approve the order for {customerName}?",
  },
  approvalFailure: {
    ja: "受注を承認できませんでした。問題が続く場合は管理者に連絡してください。",
    en: "The order could not be approved. Contact an administrator if the problem persists.",
  },
  customerLinkRequired: {
    ja: "顧客に紐付いていない受注は承認できません。管理画面で紐付けてください。",
    en: "This order is not linked to a customer. Link it on the admin screen before approval.",
  },
  requiredQuantityReached: { ja: "発注数に達しています", en: "The required quantity has been reached." },
  statusNotLendable: { ja: "[{status}] は貸出不可", en: "A tank with status {status} cannot be lent." },
  notInWarehouse: { ja: "倉庫にありません", en: "Tank is not in the warehouse" },
  typeNotInOrder: { ja: "この受注に含まれない種別です", en: "This tank type is not included in the order" },
  typeQuantityReached: { ja: "この種別は必要数スキャン済みです", en: "The required quantity for this tank type is already scanned" },
  quantityMismatch: {
    ja: "数量が一致しません ({scanned}/{required})",
    en: "The quantity does not match ({scanned}/{required}).",
  },
  fulfillmentSuccess: { ja: "受注したタンクを貸し出しました", en: "The ordered tanks were lent successfully." },
  fulfillmentFailure: {
    ja: "受注処理を完了できませんでした。問題が続く場合は管理者に連絡してください。",
    en: "Order fulfillment could not be completed. Contact an administrator if the problem persists.",
  },
  noOrders: { ja: "未対応の受注はありません", en: "There are no orders requiring action" },
  loadingOrders: { ja: "受注を読み込み中", en: "Loading orders" },
  ordersLoadFailure: {
    ja: "受注を読み込めませんでした。",
    en: "Orders could not be loaded.",
  },
  retry: { ja: "再試行", en: "Retry" },
  noOrdersHelp: {
    ja: "顧客がアプリから発注するとここに表示されます",
    en: "Orders submitted by customers appear here.",
  },
  customerUnlinked: { ja: "顧客未紐付け", en: "Customer not linked" },
  delivery: { ja: "配達", en: "Delivery" },
  pickup: { ja: "引き取り", en: "Pickup" },
  deliveryTarget: { ja: "配達先: {target}", en: "Deliver to: {target}" },
  notEntered: { ja: "未入力", en: "Not entered" },
  tankTypeMissing: { ja: "種別未入力", en: "Tank type not entered" },
  quantityTanks: { ja: "× {countLabel}", en: "× {countLabel}" },
  memo: { ja: "メモ: {memo}", en: "Note: {memo}" },
  approving: { ja: "承認中…", en: "Approving…" },
  approveOrder: { ja: "受注を承認", en: "Approve order" },
  openTankInput: { ja: "タンク入力へ", en: "Enter tanks" },
  statusPendingLink: { ja: "顧客紐付け待ち", en: "Awaiting customer link" },
  statusApproved: { ja: "承認済み", en: "Approved" },
  statusCompleted: { ja: "完了済み", en: "Completed" },
  statusPendingApproval: { ja: "承認待ち", en: "Awaiting approval" },
  statusPending: { ja: "未承認", en: "Not approved" },
  typeSummary: { ja: "{typeCountLabel}・合計{tankCountLabel}", en: "{typeCountLabel} / {tankCountLabel}" },
  deliveryDetail: { ja: "配達: {target}", en: "Delivery: {target}" },
  deliveryTargetMissing: { ja: "配達先未入力", en: "Delivery target not entered" },
  completeOrder: { ja: "受注を完了する（{customerName}）", en: "Complete order ({customerName})" },
  scanRemainingOne: { ja: "あと {count} 本スキャンしてください", en: "Scan {count} more tank" },
  scanRemainingMany: { ja: "あと {count} 本スキャンしてください", en: "Scan {count} more tanks" },
  pendingReturnTags: { ja: "返却タグ処理待ち", en: "Return tags awaiting processing" },
  manualReturnDialHint: { ja: "ダイヤル入力", en: "Dial input" },
  returnBoardEmptyTitle: {
    ja: "返却待ちのタンクはありません",
    en: "No tanks are waiting to be returned",
  },
  returnBoardEmptyHelp: {
    ja: "個別に返す場合は上の「手動返却」から",
    en: "Use Manual return above to return tanks individually",
  },
  loadingReturnRequests: { ja: "返却申請を読み込み中", en: "Loading return requests" },
  returnRequestsLoadFailure: {
    ja: "返却申請を読み込めませんでした。",
    en: "Return requests could not be loaded.",
  },
  returnGroupSummary: {
    ja: "{customerCountLabel} / {tankCountLabel}",
    en: "{customerCountLabel} / {tankCountLabel}",
  },
  hiddenItems: { ja: "+{count}件", en: "+{count} more" },
  unknownReturnTag: {
    ja: "不明なタグ（既存の処理規則が適用されます） ({value})",
    en: "Unknown tag (the existing processing rule will be applied) ({value})",
  },
  review: { ja: "確認", en: "Review" },
  tap: { ja: "タップ", en: "Tap" },
  selectReturnGroup: { ja: "{customerName}の返却タグを確認", en: "Review return tags for {customerName}" },
  returnTagProcessing: { ja: "返却タグ処理", en: "Return tag processing" },
  selectTank: { ja: "{tankId}を処理対象にする", en: "Select {tankId} for processing" },
  deselectTank: { ja: "{tankId}を処理対象から外す", en: "Remove {tankId} from processing" },
  processReturnTags: {
    ja: "{countLabel}の返却タグを処理する",
    en: "Process {countLabel}",
  },
  selectTanks: { ja: "処理するタンクを選択してください", en: "Select the tanks to process." },
  processedReturnTags: {
    ja: "{countLabel}の返却タグを処理しました",
    en: "Processed {countLabel}.",
  },
  returnTagFailure: {
    ja: "返却タグを処理できませんでした。問題が続く場合は管理者に連絡してください。",
    en: "The return tags could not be processed. Contact an administrator if the problem persists.",
  },
} satisfies Record<string, LocalizedText>;

export function getStaffOperationText(
  key: StaffOperationTextKey,
  locale: Locale = DEFAULT_LOCALE,
  params?: MessageParams,
): string {
  return formatMessage(STAFF_OPERATION_TEXT[key][locale], params);
}
