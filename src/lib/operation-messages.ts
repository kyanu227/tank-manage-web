import type { TankActionCode } from "./tank-action-status-codes";
import { getTankActionLabel } from "./tank-action-status-labels";
import { DEFAULT_LOCALE, type Locale } from "./locale";
import { formatStaffCount } from "./staff-display";

export type OperationMessageKey =
  | "manualOperation.confirm"
  | "manualOperation.returnConfirmWithCarryOver"
  | "manualOperation.success"
  | "manualOperation.failure"
  | "manualReturn.confirm"
  | "manualReturn.confirmWithCarryOver"
  | "manualReturn.success"
  | "staffLocale.saveSuccess"
  | "staffLocale.saveFailure"
  | "returnProcessing.empty"
  | "returnProcessing.pendingTagHelper"
  | "returnProcessing.pendingTagWithLatestHelper";

export type MessageParams = Record<string, string | number>;

export const OPERATION_MESSAGES = {
  "manualOperation.confirm": {
    ja: "{actionLabel}：{tankCountLabel}を処理しますか？",
    en: "Process {tankCountLabel} for {actionLabel}?",
  },
  "manualOperation.returnConfirmWithCarryOver": {
    ja: "{returnActionLabel}: {returnCountLabel} / {carryOverLabel}: {keepCountLabel}を処理しますか？",
    en: "Process {returnCountLabel} / {keepCountLabel}?",
  },
  "manualOperation.success": {
    ja: "{tankCountLabel}の処理が完了しました",
    en: "{tankCountLabel} processed.",
  },
  "manualOperation.failure": {
    ja: "{actionLabel}に失敗しました。",
    en: "Failed to run {actionLabel}.",
  },
  "manualReturn.confirm": {
    ja: "返却：{returnCountLabel}を処理しますか？",
    en: "Process {returnCountLabel}?",
  },
  "manualReturn.confirmWithCarryOver": {
    ja: "返却: {returnCountLabel} / 持ち越し: {keepCountLabel}を処理しますか？",
    en: "Process {returnCountLabel} / {keepCountLabel}?",
  },
  "manualReturn.success": {
    ja: "{tankCountLabel}の処理が完了しました",
    en: "{tankCountLabel} processed.",
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

export type ManualReturnMessageParams = {
  tankCount: number;
  returnCount: number;
  keepCount?: number;
};

export function getManualOperationConfirmMessage(
  actionCode: TankActionCode,
  locale: Locale = DEFAULT_LOCALE,
  params: ManualOperationMessageParams = { tankCount: 0 },
): string {
  const keepCount = params.keepCount ?? 0;

  if (actionCode === "return" && keepCount > 0) {
    const returnCount = params.returnCount ?? Math.max(params.tankCount - keepCount, 0);
    return getOperationMessage("manualOperation.returnConfirmWithCarryOver", locale, {
      returnActionLabel: getTankActionLabel("return", locale),
      returnCountLabel: formatStaffCount(returnCount, locale, {
        ja: "本", enSingular: "return", enPlural: "returns",
      }),
      carryOverLabel: locale === "ja" ? "持ち越し" : "Carry-over",
      keepCountLabel: formatStaffCount(keepCount, locale, {
        ja: "本", enSingular: "carry-over", enPlural: "carry-overs",
      }),
    });
  }

  return getOperationMessage("manualOperation.confirm", locale, {
    actionLabel: getTankActionLabel(actionCode, locale),
    tankCountLabel: formatStaffCount(params.tankCount, locale, {
      ja: "本", enSingular: "tank", enPlural: "tanks",
    }),
  });
}

export function getManualOperationSuccessMessage(
  _actionCode: TankActionCode,
  locale: Locale = DEFAULT_LOCALE,
  params: ManualOperationMessageParams = { tankCount: 0 },
): string {
  return getOperationMessage("manualOperation.success", locale, {
    tankCountLabel: formatStaffCount(params.tankCount, locale, {
      ja: "本", enSingular: "tank", enPlural: "tanks",
    }),
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

export function getManualReturnConfirmMessage(
  locale: Locale = DEFAULT_LOCALE,
  params: ManualReturnMessageParams,
): string {
  const keepCount = params.keepCount ?? 0;

  if (keepCount > 0) {
    return getOperationMessage("manualReturn.confirmWithCarryOver", locale, {
      returnCountLabel: formatStaffCount(params.returnCount, locale, {
        ja: "本", enSingular: "return", enPlural: "returns",
      }),
      keepCountLabel: formatStaffCount(keepCount, locale, {
        ja: "本", enSingular: "carry-over", enPlural: "carry-overs",
      }),
    });
  }

  return getOperationMessage("manualReturn.confirm", locale, {
    returnCountLabel: formatStaffCount(params.returnCount, locale, {
      ja: "本", enSingular: "return", enPlural: "returns",
    }),
  });
}

export function getManualReturnSuccessMessage(
  locale: Locale = DEFAULT_LOCALE,
  params: ManualReturnMessageParams,
): string {
  return getOperationMessage("manualReturn.success", locale, {
    tankCountLabel: formatStaffCount(params.tankCount, locale, {
      ja: "本", enSingular: "return item", enPlural: "return items",
    }),
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
