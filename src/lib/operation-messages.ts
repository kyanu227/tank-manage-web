import type { TankActionCode } from "./tank-action-status-codes";
import { getTankActionLabel } from "./tank-action-status-labels";
import { DEFAULT_LOCALE, type Locale } from "./locale";

export type OperationMessageKey =
  | "manualOperation.confirm"
  | "manualOperation.success"
  | "manualOperation.failure"
  | "staffLocale.saveSuccess"
  | "staffLocale.saveFailure"
  | "returnProcessing.empty";

export type MessageParams = Record<string, string | number>;

export const OPERATION_MESSAGES = {
  "manualOperation.confirm": {
    ja: "{actionLabel}を実行しますか？",
    en: "Run {actionLabel}?",
  },
  "manualOperation.success": {
    ja: "{actionLabel}が完了しました。",
    en: "{actionLabel} completed.",
  },
  "manualOperation.failure": {
    ja: "{actionLabel}に失敗しました。",
    en: "Failed to run {actionLabel}.",
  },
  "staffLocale.saveSuccess": {
    ja: "表示言語を保存しました。",
    en: "Display language saved.",
  },
  "staffLocale.saveFailure": {
    ja: "表示言語の保存に失敗しました。",
    en: "Failed to save display language.",
  },
  "returnProcessing.empty": {
    ja: "処理待ちの返却申請はありません。",
    en: "There are no return requests waiting for processing.",
  },
} satisfies Record<OperationMessageKey, Record<Locale, string>>;

export function formatMessage(
  template: string,
  params: MessageParams = {},
): string {
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (placeholder, key: string) => {
    const value = params[key];
    return value === undefined ? placeholder : String(value);
  });
}

export function getOperationMessage(
  key: OperationMessageKey,
  locale: Locale = DEFAULT_LOCALE,
  params?: MessageParams,
): string {
  return formatMessage(OPERATION_MESSAGES[key][locale], params);
}

export function getManualOperationConfirmMessage(
  actionCode: TankActionCode,
  locale: Locale = DEFAULT_LOCALE,
): string {
  return getOperationMessage("manualOperation.confirm", locale, {
    actionLabel: getTankActionLabel(actionCode, locale),
  });
}

export function getManualOperationSuccessMessage(
  actionCode: TankActionCode,
  locale: Locale = DEFAULT_LOCALE,
): string {
  return getOperationMessage("manualOperation.success", locale, {
    actionLabel: getTankActionLabel(actionCode, locale),
  });
}

export function getManualOperationFailureMessage(
  actionCode: TankActionCode,
  locale: Locale = DEFAULT_LOCALE,
): string {
  return getOperationMessage("manualOperation.failure", locale, {
    actionLabel: getTankActionLabel(actionCode, locale),
  });
}

export function getStaffLocaleSaveSuccessMessage(
  locale: Locale = DEFAULT_LOCALE,
): string {
  return getOperationMessage("staffLocale.saveSuccess", locale);
}

export function getStaffLocaleSaveFailureMessage(
  locale: Locale = DEFAULT_LOCALE,
): string {
  return getOperationMessage("staffLocale.saveFailure", locale);
}
