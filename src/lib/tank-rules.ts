/**
 * タンク状態遷移ルール
 *
 * 全ページが参照する唯一の遷移ルール定義。
 * ステータス文字列・遷移テーブル・バリデーション関数を一元管理する。
 *
 * 関心事の分離:
 *   - tank-rules.ts    → タンクに何が起きるか（このファイル）
 *   - incentive-rules.ts → スタッフに何が起きるか（報酬・ランク）
 *   - billing-rules.ts   → 顧客に何が起きるか（請求）
 */

/* ════════════════════════════════════════════
   1. ステータス定数
   ════════════════════════════════════════════ */

export const STATUS = {
  FILLED: "充填済み",
  EMPTY: "空",
  LENT: "貸出中",
  UNRETURNED: "未返却",
  IN_HOUSE: "自社利用中",
  DAMAGED: "破損",
  DEFECTIVE: "不良",
  DISPOSED: "破棄",
} as const;

export type TankStatus = (typeof STATUS)[keyof typeof STATUS];

/* ════════════════════════════════════════════
   2. 返却タグ
   ════════════════════════════════════════════ */

export const RETURN_TAG = {
  NORMAL: "normal",
  UNUSED: "unused",
  DEFECT: "defect",
} as const;

export type ReturnTag = (typeof RETURN_TAG)[keyof typeof RETURN_TAG];

/* ════════════════════════════════════════════
   3. 操作定義
   ════════════════════════════════════════════ */

export const ACTION = {
  // メインサイクル
  LEND: "貸出",
  RETURN: "返却",
  RETURN_UNUSED: "未使用返却",
  RETURN_DEFECT: "返却(未充填)",
  CARRY_OVER: "持ち越し",
  FILL: "充填",

  // 自社利用
  IN_HOUSE_USE: "自社利用",
  IN_HOUSE_USE_RETRO: "自社利用(事後)",
  IN_HOUSE_RETURN: "自社返却",
  IN_HOUSE_RETURN_UNUSED: "自社返却(未使用)",
  IN_HOUSE_RETURN_DEFECT: "自社返却(不備)",

  // 異常系・メンテナンス
  DAMAGE_REPORT: "破損報告",
  REPAIRED: "修理済み",
  INSPECTION: "耐圧検査完了",

  // 破棄
  DISPOSE: "破棄",
} as const;

export type TankAction = (typeof ACTION)[keyof typeof ACTION];

/* ════════════════════════════════════════════
   4. 遷移ルールテーブル (OP_RULES)
   ════════════════════════════════════════════ */

interface TransitionRule {
  /** 許容する元ステータス。空配列 = 制限なし */
  allowedPrev: TankStatus[];
  /** 遷移先ステータス */
  nextStatus: TankStatus;
}

export const OP_RULES: Record<TankAction, TransitionRule> = {
  // ── メインサイクル ──
  [ACTION.LEND]: {
    allowedPrev: [STATUS.FILLED],
    nextStatus: STATUS.LENT,
  },
  [ACTION.RETURN]: {
    allowedPrev: [STATUS.LENT, STATUS.UNRETURNED, STATUS.IN_HOUSE],
    nextStatus: STATUS.EMPTY,
  },
  [ACTION.RETURN_UNUSED]: {
    allowedPrev: [STATUS.LENT, STATUS.UNRETURNED, STATUS.IN_HOUSE],
    nextStatus: STATUS.FILLED,
  },
  [ACTION.RETURN_DEFECT]: {
    allowedPrev: [STATUS.LENT, STATUS.UNRETURNED, STATUS.IN_HOUSE],
    nextStatus: STATUS.EMPTY,
  },
  [ACTION.CARRY_OVER]: {
    allowedPrev: [STATUS.LENT],
    nextStatus: STATUS.UNRETURNED,
  },
  [ACTION.FILL]: {
    allowedPrev: [STATUS.EMPTY],
    nextStatus: STATUS.FILLED,
  },

  // ── 自社利用 ──
  [ACTION.IN_HOUSE_USE]: {
    allowedPrev: [STATUS.FILLED],
    nextStatus: STATUS.IN_HOUSE,
  },
  [ACTION.IN_HOUSE_USE_RETRO]: {
    allowedPrev: [STATUS.FILLED],
    nextStatus: STATUS.IN_HOUSE,
  },
  [ACTION.IN_HOUSE_RETURN]: {
    allowedPrev: [STATUS.IN_HOUSE],
    nextStatus: STATUS.EMPTY,
  },
  [ACTION.IN_HOUSE_RETURN_UNUSED]: {
    allowedPrev: [STATUS.IN_HOUSE],
    nextStatus: STATUS.FILLED,
  },
  [ACTION.IN_HOUSE_RETURN_DEFECT]: {
    allowedPrev: [STATUS.IN_HOUSE],
    nextStatus: STATUS.EMPTY,
  },

  // ── 異常系・メンテナンス ──
  [ACTION.DAMAGE_REPORT]: {
    allowedPrev: [STATUS.EMPTY, STATUS.FILLED, STATUS.IN_HOUSE],
    nextStatus: STATUS.DAMAGED,
  },
  [ACTION.REPAIRED]: {
    allowedPrev: [STATUS.DAMAGED, STATUS.DEFECTIVE],
    nextStatus: STATUS.EMPTY,
  },
  [ACTION.INSPECTION]: {
    allowedPrev: [], // リストから選択するため制限なし
    nextStatus: STATUS.EMPTY,
  },

  // ── 破棄 ──
  [ACTION.DISPOSE]: {
    allowedPrev: [STATUS.EMPTY, STATUS.FILLED, STATUS.DAMAGED],
    nextStatus: STATUS.DISPOSED,
  },
};

/* ════════════════════════════════════════════
   5. バリデーション
   ════════════════════════════════════════════ */

export interface ValidationResult {
  ok: boolean;
  /** エラー時のメッセージ */
  reason?: string;
}

/**
 * 指定された操作がそのタンクの現在ステータスに対して許可されるか検証する。
 */
export function validateTransition(
  currentStatus: string,
  action: TankAction
): ValidationResult {
  const rule = OP_RULES[action];
  if (!rule) {
    return { ok: false, reason: `不明な操作: ${action}` };
  }

  // allowedPrev が空 = 制限なし
  if (rule.allowedPrev.length === 0) {
    return { ok: true };
  }

  if (rule.allowedPrev.includes(currentStatus as TankStatus)) {
    return { ok: true };
  }

  return {
    ok: false,
    reason: `「${currentStatus}」のタンクに「${action}」はできません（許容: ${rule.allowedPrev.join(", ")}）`,
  };
}

/**
 * 指定された操作の遷移先ステータスを返す。
 */
export function getNextStatus(action: TankAction): TankStatus {
  return OP_RULES[action].nextStatus;
}

/* ════════════════════════════════════════════
   6. 返却タグ → 操作名の解決
   ════════════════════════════════════════════ */

/**
 * 返却タグから実際の操作名（アクション）を解決する。
 * 自社利用中からの返却は自動的に自社返却系に変換される。
 */
export function resolveReturnAction(
  tag: ReturnTag,
  fromStatus: string
): TankAction {
  const isInHouse = fromStatus === STATUS.IN_HOUSE;

  switch (tag) {
    case RETURN_TAG.UNUSED:
      return isInHouse ? ACTION.IN_HOUSE_RETURN_UNUSED : ACTION.RETURN_UNUSED;
    case RETURN_TAG.DEFECT:
      return isInHouse ? ACTION.IN_HOUSE_RETURN_DEFECT : ACTION.RETURN_DEFECT;
    case RETURN_TAG.NORMAL:
    default:
      return isInHouse ? ACTION.IN_HOUSE_RETURN : ACTION.RETURN;
  }
}

/**
 * 返却タグから遷移先ステータスを直接解決する。
 */
export function resolveReturnStatus(tag: ReturnTag): TankStatus {
  return tag === RETURN_TAG.UNUSED ? STATUS.FILLED : STATUS.EMPTY;
}

/* ════════════════════════════════════════════
   7. ログ用の操作名解決
   ════════════════════════════════════════════ */

/**
 * 返却タグ + 元ステータスから、ログに記録する操作名を返す。
 */
export function resolveLogAction(
  tag: ReturnTag,
  fromStatus: string
): string {
  return resolveReturnAction(tag, fromStatus);
}

/* ════════════════════════════════════════════
   8. ステータス表示用ユーティリティ
   ════════════════════════════════════════════ */

/** ダッシュボード等で使うステータス → 色のマッピング */
export const STATUS_COLORS: Record<string, string> = {
  [STATUS.FILLED]: "#22c55e",
  [STATUS.EMPTY]: "#78716c",
  [STATUS.LENT]: "#3b82f6",
  [STATUS.UNRETURNED]: "#a78bfa",
  [STATUS.IN_HOUSE]: "#f59e0b",
  [STATUS.DAMAGED]: "#ef4444",
  [STATUS.DEFECTIVE]: "#f87171",
  [STATUS.DISPOSED]: "#374151",
};

/** 操作が自社系かどうか判定 */
export function isInHouseAction(action: string): boolean {
  return action.includes("自社");
}

/** 破棄済みかどうか判定 */
export function isDisposed(status: string): boolean {
  return status === STATUS.DISPOSED;
}
