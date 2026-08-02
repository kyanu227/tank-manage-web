import { DEFAULT_LOCALE, type Locale } from "./locale";
import { formatMessage, type MessageParams } from "./operation-messages";
import {
  getStaffGenericErrorMessage,
  type LocalizedText,
} from "./staff-display";
import {
  getLegacyTankActionLabel,
  getLegacyTankStatusLabel,
} from "./tank-action-status-labels";
import { TANK_RECOVERY_CONFIRMATION_TEXT } from "./tank-recovery-confirmation-message";
import {
  isStaffOperationError,
  type StaffOperationErrorCode,
} from "./staff-operation-error-code";

export {
  isStaffOperationError,
  StaffOperationError,
  type StaffOperationErrorCode,
  type StaffOperationErrorLike,
  type StaffOperationErrorOptions,
  type StaffOperationErrorParams,
} from "./staff-operation-error-code";

export const STAFF_OPERATION_ERROR_TEXT = {
  reason_too_short: {
    ja: "理由は{minLength}文字以上で入力してください",
    en: "Enter a reason of at least {minLength} characters.",
  },
  tank_not_found: {
    ja: "[{tankId}] タンクが存在しません",
    en: "Tank {tankId} could not be found. Review the tank number.",
  },
  invalid_tank_id: {
    ja: "[{tankId}] タンクIDが不正です",
    en: "Tank ID {tankId} is invalid. Review the tank number.",
  },
  operation_not_allowed: {
    ja: "[{tankId}] ステータス「{status}」のタンクには「{action}」を実行できません",
    en: "Tank {tankId} cannot run {action} while its status is {status}.",
  },
  tank_disposed: {
    ja: "[{tankId}] 破棄済みタンクは操作できません。",
    en: "Tank {tankId} has been disposed and cannot be operated on.",
  },
  customer_required: {
    ja: "[{tankId}] 貸出先を選択してください。",
    en: "Select a customer before operating on tank {tankId}.",
  },
  customer_mismatch: {
    ja: "持ち越し操作の顧客情報が現在貸出先と一致しません",
    en: "The carry-over customer does not match the tank's current customer. Reload and review the tank.",
  },
  selection_required: {
    ja: "処理するタンクを選択してください",
    en: "Select at least one tank to process.",
  },
  duplicate_tank: {
    ja: "[{tankId}] 同一タンクへの複数操作は一括処理できません",
    en: "Tank {tankId} is listed more than once. Remove the duplicate entry.",
  },
  recovery_confirmation_required: {
    ja: "正規の状態遷移へ自動補完するため、現物確認が必要です。",
    en: "Physical verification is required before state-transition recovery can continue.",
  },
  recovery_cancelled: TANK_RECOVERY_CONFIRMATION_TEXT.cancelled,
  recovery_browser_required: TANK_RECOVERY_CONFIRMATION_TEXT.browserRequired,
  recovery_previous_customer_missing:
    TANK_RECOVERY_CONFIRMATION_TEXT.missingPreviousCustomer,
  recovery_source_log_required: {
    ja: "復元元ログが指定されていません",
    en: "A source log is required for recovery.",
  },
  recovery_source_log_not_found: {
    ja: "復元元ログが存在しません",
    en: "The recovery source log does not exist.",
  },
  recovery_tank_log_required: {
    ja: "タンク操作ログだけ復元できます",
    en: "Only tank-operation logs can be restored.",
  },
  recovery_voided_revision_forbidden: {
    ja: "取消済み revision には戻せません",
    en: "A voided revision cannot be restored.",
  },
  recovery_generated_revision_forbidden: {
    ja: "自動補完されたrevisionへは直接復元できません",
    en: "An automatically generated recovery revision cannot be restored directly.",
  },
  recovery_unofficial_revision_forbidden: {
    ja: "正式集計状態を確認できないrevisionへは復元できません",
    en: "A revision whose official aggregation state cannot be verified cannot be restored.",
  },
  recovery_chain_mismatch: {
    ja: "同一チェーン内のログだけ復元できます",
    en: "Only a log in the same revision chain can be restored.",
  },
  target_log_not_found: {
    ja: "対象ログが存在しません",
    en: "The selected log no longer exists. Reload the activity log.",
  },
  target_log_transition_plan_unverifiable: {
    ja: "対象ログのtransitionPlanを検証できません",
    en: "The selected log's transition plan could not be verified.",
  },
  direct_log_aggregation_invalid: {
    ja: "直接操作ログの集計状態が不正なため編集できません",
    en: "This direct-operation log cannot be edited because its aggregation state is invalid.",
  },
  log_already_replaced: {
    ja: "このログはすでに置換されています",
    en: "This log has already been replaced. Reload the activity log.",
  },
  latest_log_required: {
    ja: "最新の有効ログだけ編集・取消できます",
    en: "Only the latest active log can be edited or voided. Reload and select the latest log.",
  },
  log_not_active: {
    ja: "有効なログだけ編集・取消できます",
    en: "Only an active log can be edited or voided. Reload and select an active log.",
  },
  tank_log_required: {
    ja: "タンク操作ログだけ編集・取消できます",
    en: "Only a tank-operation log can be edited or voided. Select a tank-operation log.",
  },
  recovery_log_not_editable: {
    ja: "自動補完ログは直接編集できません。取消後に正しい操作を再実行してください",
    en: "A recovery log cannot be edited directly. Void it, then run the correct operation.",
  },
  log_original_at_missing: {
    ja: "対象ログのoriginalAtがありません",
    en: "The selected log does not have originalAt.",
  },
  log_timestamp_missing: {
    ja: "対象ログのtimestampがありません",
    en: "The selected log does not have a timestamp.",
  },
  ordered_lend_transaction_required: {
    ja: "受注貸出は受注transactionの完了処理でだけ実行できます",
    en: "An order-based lend operation can only run when completing its order transaction.",
  },
  inspection_date_update_forbidden: {
    ja: "耐圧日情報は耐圧検査操作でだけ更新できます",
    en: "Pressure-test date fields can only be updated by an inspection operation.",
  },
  carry_over_previous_customer_projection_invalid: {
    ja: "持ち越し前の顧客projectionが不正です",
    en: "The customer projection before carry-over is invalid.",
  },
  log_transition_plan_unverifiable: {
    ja: "transitionPlanを検証できないログは編集・取消できません",
    en: "Logs whose transition plan cannot be verified cannot be edited or voided.",
  },
  log_revision_created_at_missing: {
    ja: "対象ログの作成日時を確認できません",
    en: "The selected log's creation time could not be verified.",
  },
  correction_window_expired: {
    ja: "一般スタッフは72時間を過ぎたログを編集・取消できません",
    en: "Staff cannot edit or void logs older than 72 hours. Ask an administrator for help.",
  },
  stale_tank_cycle: {
    ja: "タンクの貸出cycleが操作候補の作成後に変更されています。",
    en: "The tank's rental cycle changed after it was selected. Reload and review the tank.",
  },
  staff_session_invalid: {
    ja: "スタッフセッションを確認できません。再ログインしてください。",
    en: "Your staff session could not be verified. Sign in again.",
  },
} satisfies Record<StaffOperationErrorCode, LocalizedText>;

type StaffOperationErrorMessageOptions = Readonly<{
  unknownMessage?: string;
}>;

export function getStaffOperationErrorMessage(
  error: unknown,
  locale: Locale = DEFAULT_LOCALE,
  options: StaffOperationErrorMessageOptions = {},
): string {
  if (!isStaffOperationError(error)) {
    const legacyMessage = locale === "ja" ? readErrorMessage(error) : null;
    return legacyMessage
      ?? options.unknownMessage
      ?? getStaffGenericErrorMessage(locale);
  }

  const explicitMessage = locale === "ja" ? readErrorMessage(error) : null;
  if (explicitMessage) return explicitMessage;
  return formatCatalogMessage(error.code, error.params, locale)
    ?? options.unknownMessage
    ?? getStaffGenericErrorMessage(locale);
}

export function logStaffOperationError(
  context: string,
  error: unknown,
): void {
  const cause = getErrorCause(error);
  if (cause === undefined) {
    console.error(context, error);
    return;
  }
  console.error(context, error, "cause", cause);
}

function getErrorCause(error: unknown): unknown {
  if (!error || typeof error !== "object" || !("cause" in error)) return undefined;
  return (error as { cause?: unknown }).cause;
}

function formatCatalogMessage(
  code: StaffOperationErrorCode,
  rawParams: unknown,
  locale: Locale,
): string | null {
  const template = STAFF_OPERATION_ERROR_TEXT[code][locale];
  const params = localizedParams(code, rawParams, locale);
  const requiredParams = [...template.matchAll(/\{([A-Za-z0-9_]+)\}/g)]
    .map((match) => match[1]);
  if (requiredParams.some((key) => params[key] === undefined)) return null;
  return formatMessage(template, params);
}

function localizedParams(
  code: StaffOperationErrorCode,
  rawParams: unknown,
  locale: Locale,
): MessageParams {
  const params = normalizeMessageParams(rawParams);
  if (code !== "operation_not_allowed") return params;
  const rawAction = String(params.action ?? "");
  const rawStatus = String(params.status ?? "");
  return {
    ...params,
    action: getLegacyTankActionLabel(rawAction, locale)
      ?? (locale === "ja" ? "選択した操作" : "the selected operation"),
    status: getLegacyTankStatusLabel(rawStatus, locale)
      ?? (locale === "ja" ? "現在の状態" : "the current status"),
  };
}

function normalizeMessageParams(value: unknown): MessageParams {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const params: MessageParams = {};
  Object.entries(value).forEach(([key, candidate]) => {
    if (typeof candidate === "string" || typeof candidate === "number") {
      params[key] = candidate;
    }
  });
  return params;
}

function readErrorMessage(error: unknown): string | null {
  if (!error || typeof error !== "object" || !("message" in error)) return null;
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" && message.trim() ? message : null;
}
