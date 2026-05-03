/**
 * 請求ルール
 *
 * 「顧客に何が起きるか」を管理する。
 * 状態遷移（tank-rules.ts）、報酬（incentive-rules.ts）とは独立して変更可能。
 *
 * 請求対象 = 顧客が実際にタンクを使用した貸出分のみ。
 */

import { ACTION, type TankAction } from "./tank-rules";

/* ════════════════════════════════════════════
   1. 請求可否の判定
   ════════════════════════════════════════════ */

/**
 * 返却種別ごとの請求可否。
 *
 * 通常返却    → 請求可（顧客が使用した）
 * 未使用返却  → 請求不可（顧客が使用していない、ガスが残っている）
 * 未充填返却  → 請求不可（こちら側の充填ミス）
 */
const BILLABLE_ACTIONS: Set<TankAction> = new Set([
  ACTION.RETURN,
]);

const NON_BILLABLE_ACTIONS: Set<TankAction> = new Set([
  ACTION.RETURN_UNUSED,
  ACTION.RETURN_UNCHARGED,
]);

/**
 * その操作が請求対象かどうか判定する。
 *
 * - 返却系のみ請求の概念がある
 * - 貸出・充填・自社系・破損系は請求対象外（null を返す）
 * - 返却の場合は true/false を返す
 */
export function isBillable(action: string): boolean | null {
  if (BILLABLE_ACTIONS.has(action as TankAction)) {
    return true;
  }
  if (NON_BILLABLE_ACTIONS.has(action as TankAction)) {
    return false;
  }
  // 返却系以外は請求の概念なし
  return null;
}

/* ════════════════════════════════════════════
   2. 一括返却時の請求判定
   ════════════════════════════════════════════ */

import { RETURN_TAG, type ReturnTag } from "./tank-rules";

/**
 * 返却タグから請求可否を判定する。
 * 一括返却画面など、タグベースで処理する場合に使用。
 */
export function isBillableByTag(tag: ReturnTag): boolean {
  return tag === RETURN_TAG.NORMAL;
}

/* ════════════════════════════════════════════
   3. 請求レポート用ユーティリティ
   ════════════════════════════════════════════ */

export interface ReturnRecord {
  tankId: string;
  action: string;
  destination: string;
  timestamp: Date;
}

/**
 * 返却記録の配列から、請求可能な返却のみをフィルタする。
 * 請求書発行ロジックの入力として使用。
 */
export function filterBillableReturns(
  records: ReturnRecord[]
): ReturnRecord[] {
  return records.filter((r) => isBillable(r.action) === true);
}

/**
 * 貸出先ごとの請求対象数を集計する。
 */
export function countBillableByDestination(
  records: ReturnRecord[]
): Record<string, number> {
  const result: Record<string, number> = {};

  for (const r of records) {
    if (isBillable(r.action) !== true) continue;
    result[r.destination] = (result[r.destination] ?? 0) + 1;
  }

  return result;
}
