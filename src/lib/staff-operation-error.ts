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

const STAFF_OPERATION_ERROR_BRAND = "StaffOperationError";

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
  recovery_cancelled: TANK_RECOVERY_CONFIRMATION_TEXT.cancelled,
  recovery_browser_required: TANK_RECOVERY_CONFIRMATION_TEXT.browserRequired,
  recovery_previous_customer_missing:
    TANK_RECOVERY_CONFIRMATION_TEXT.missingPreviousCustomer,
  target_log_not_found: {
    ja: "対象ログが存在しません",
    en: "The selected log no longer exists. Reload the activity log.",
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
} satisfies Record<string, LocalizedText>;

export type StaffOperationErrorCode = keyof typeof STAFF_OPERATION_ERROR_TEXT;

type StaffOperationErrorOptions = Readonly<{
  params?: MessageParams;
  message?: string;
  cause?: unknown;
}>;

type StaffOperationErrorLike = Readonly<{
  name?: unknown;
  staffOperationErrorBrand?: unknown;
  code: StaffOperationErrorCode;
  params?: unknown;
  message?: unknown;
  cause?: unknown;
}>;

type StaffOperationErrorMessageOptions = Readonly<{
  unknownMessage?: string;
}>;

export class StaffOperationError extends Error {
  readonly staffOperationErrorBrand = STAFF_OPERATION_ERROR_BRAND;
  readonly code: StaffOperationErrorCode;
  readonly params: Readonly<MessageParams>;
  override readonly cause?: unknown;

  constructor(
    code: StaffOperationErrorCode,
    options: StaffOperationErrorOptions = {},
  ) {
    const params = Object.freeze({ ...(options.params ?? {}) });
    super(options.message ?? formatCatalogMessage(code, params, "ja")
      ?? getStaffGenericErrorMessage("ja"));
    this.name = "StaffOperationError";
    this.code = code;
    this.params = params;
    if (options.cause !== undefined) this.cause = options.cause;
  }
}

export function isStaffOperationError(
  error: unknown,
): error is StaffOperationErrorLike {
  if (error instanceof StaffOperationError) return true;
  if (!error || typeof error !== "object") return false;
  const candidate = error as Partial<StaffOperationErrorLike>;
  if (!isStaffOperationErrorCode(candidate.code)) return false;
  return candidate.staffOperationErrorBrand === STAFF_OPERATION_ERROR_BRAND
    || candidate.name === "StaffOperationError"
    || candidate.name === "StaleTankCycleError";
}

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

function isStaffOperationErrorCode(
  code: unknown,
): code is StaffOperationErrorCode {
  return typeof code === "string" && code in STAFF_OPERATION_ERROR_TEXT;
}
