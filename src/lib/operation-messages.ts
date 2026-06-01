import type { TankActionCode } from "./tank-action-status-codes";
import { getTankActionLabel } from "./tank-action-status-labels";
import { DEFAULT_LOCALE, type Locale } from "./locale";

export type OperationMessageKey =
  | "manualOperation.confirm"
  | "manualOperation.returnConfirmWithCarryOver"
  | "manualOperation.success"
  | "manualOperation.failure"
  | "staffLocale.saveSuccess"
  | "staffLocale.saveFailure"
  | "returnProcessing.empty"
  | "returnProcessing.pendingTagHelper"
  | "returnProcessing.pendingTagWithLatestHelper";

export type MessageParams = Record<string, string | number>;

export const OPERATION_MESSAGES = {
  "manualOperation.confirm": {
    ja: "{actionLabel}：{tankCount}本を処理しますか？",
    en: "Process {tankCount} tanks for {actionLabel}?",
  },
  "manualOperation.returnConfirmWithCarryOver": {
    ja: "{returnActionLabel}: {returnCount}本 / {carryOverLabel}: {keepCount}本を処理しますか？",
    en: "Process {returnCount} returns / {keepCount} carry-overs?",
  },
  "manualOperation.success": {
    ja: "{tankCount}本の処理が完了しました",
    en: "{tankCount} tanks processed.",
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
    ja: "表示言語を保存できませんでした。再ログインしてからお試しください。",
    en: "Could not save the display language. Please sign in again and try again.",
  },
  "returnProcessing.empty": {
    ja: "処理待ちの返却タグはありません",
    en: "There are no return tags waiting for processing.",
  },
  "returnProcessing.pendingTagHelper": {
    ja: "タグ処理待ち",
    en: "Awaiting tag processing",
  },
  "returnProcessing.pendingTagWithLatestHelper": {
    ja: "タグ処理待ち / 最新 {requestedAt}",
    en: "Awaiting tag processing / Latest {requestedAt}",
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

export type ManualOperationMessageParams = {
  tankCount: number;
  returnCount?: number;
  keepCount?: number;
};

export function getManualOperationConfirmMessage(
  actionCode: TankActionCode,
  locale: Locale = DEFAULT_LOCALE,
  params: ManualOperationMessageParams = { tankCount: 0 },
): string {
  const keepCount = params.keepCount ?? 0;

  if (actionCode === "return" && keepCount > 0) {
    return getOperationMessage("manualOperation.returnConfirmWithCarryOver", locale, {
      returnActionLabel: getTankActionLabel("return", locale),
      returnCount: params.returnCount ?? Math.max(params.tankCount - keepCount, 0),
      carryOverLabel: locale === "ja" ? "持ち越し" : "Carry-over",
      keepCount,
    });
  }

  return getOperationMessage("manualOperation.confirm", locale, {
    actionLabel: getTankActionLabel(actionCode, locale),
    tankCount: params.tankCount,
  });
}

export function getManualOperationSuccessMessage(
  _actionCode: TankActionCode,
  locale: Locale = DEFAULT_LOCALE,
  params: ManualOperationMessageParams = { tankCount: 0 },
): string {
  return getOperationMessage("manualOperation.success", locale, {
    tankCount: params.tankCount,
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
