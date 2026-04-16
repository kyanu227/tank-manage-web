/**
 * インセンティブ（報酬・スコア）ルール
 *
 * 「スタッフに何が起きるか」を管理する。
 * 状態遷移（tank-rules.ts）とは独立して変更可能。
 *
 * デフォルト値はコードで定義し、Firestoreに設定があればそちらを優先。
 * 管理画面の priceMaster / rankMaster で単価・ランク条件を変更可能。
 *
 * 未充填返却時の自動取消:
 *   未充填返却が発生 → 直前の充填者を特定 → その充填の報酬を自動取消
 *   回収作業自体には報酬を発生させる（労力に対する対価）
 */

import { ACTION, type TankAction } from "./tank-rules";

/* ════════════════════════════════════════════
   1. 報酬対象の判定
   ════════════════════════════════════════════ */

/**
 * 報酬・スコアが発生しない操作の一覧。
 *
 * 除外理由:
 * - 自社系: 自社利用は売上に貢献しないため報酬対象外
 * - 破棄: メンテナンス作業であり報酬対象外
 *
 * ※ 未充填返却（回収作業）は報酬あり（労力がかかるため）
 * ※ 未充填を作った充填者の報酬は別途自動取消される
 */
const NO_REWARD_ACTIONS: Set<TankAction> = new Set([
  // 自社系（全て報酬なし）
  ACTION.IN_HOUSE_USE,
  ACTION.IN_HOUSE_USE_RETRO,
  ACTION.IN_HOUSE_RETURN,
  ACTION.IN_HOUSE_RETURN_UNUSED,
  ACTION.IN_HOUSE_RETURN_DEFECT,

  // 破棄
  ACTION.DISPOSE,
]);

/**
 * その操作が報酬・スコアの対象かどうか判定する。
 *
 * 注意: 未充填返却（回収作業）は報酬対象。
 * 未充填を作った充填者の報酬取消は buildRevocation() で別途処理する。
 *
 * 判定は NO_REWARD_ACTIONS の集合メンバシップのみで行う。
 * ACTION 定数に含まれない未知の操作名はデフォルトで報酬対象とする。
 */
export function isRewardEligible(action: string): boolean {
  return !NO_REWARD_ACTIONS.has(action as TankAction);
}

/**
 * 未充填返却時に、直前の充填者の報酬を自動取消する。
 *
 * フロー:
 *   1. 未充填返却のログから tankId を取得
 *   2. tank-trace の traceUnderfilledSource() で充填者を特定
 *   3. その充填の金銭ログに revoked フラグを立てる
 *   4. 取消記録をログに残す
 *
 * ※ 回収した人の報酬は通常通り発生する
 *
 * @returns 取消対象の充填ログID（null = 充填ログが見つからなかった）
 */
export interface RewardRevocation {
  /** 取消対象の充填ログID */
  fillingLogId: string;
  /** 充填を行ったスタッフ名 */
  fillingStaffName: string;
  /** 充填日時 */
  fillingTimestamp: Date;
  /** 未充填返却のログID */
  triggerLogId: string;
  /** タンクID */
  tankId: string;
}

/**
 * 未充填返却のログ情報から、取消すべき充填の情報を構築する。
 * 実際のFirestore書き込みは呼び出し元が行う（操作のatomicity確保のため）。
 */
export function buildRevocation(
  fillingLogId: string,
  fillingStaffName: string,
  fillingTimestamp: Date,
  triggerLogId: string,
  tankId: string
): RewardRevocation {
  return {
    fillingLogId,
    fillingStaffName,
    fillingTimestamp,
    triggerLogId,
    tankId,
  };
}

/* ════════════════════════════════════════════
   2. スコア計算の補助
   ════════════════════════════════════════════ */

/**
 * 共同作業時のスコア分割。
 * スコアは作業人数で均等割り（端数切捨て）。
 */
export function splitScore(baseScore: number, workerCount: number): number {
  if (workerCount <= 1) return baseScore;
  return Math.floor(baseScore / workerCount);
}

/**
 * 共同作業時の報酬分割。
 * 報酬は作業人数で均等割り（端数切捨て）。
 */
export function splitReward(baseReward: number, workerCount: number): number {
  if (workerCount <= 1) return baseReward;
  return Math.floor(baseReward / workerCount);
}

/* ════════════════════════════════════════════
   3. ランク判定
   ════════════════════════════════════════════ */

export interface RankDefinition {
  name: string;
  requiredScore: number;
}

/**
 * スコアからランクを判定する。
 * rankDefs はスコア降順でソートされている前提。
 *
 * 例: [
 *   { name: "プラチナ", requiredScore: 200 },
 *   { name: "ゴールド", requiredScore: 150 },
 *   { name: "シルバー",  requiredScore: 100 },
 *   { name: "ブロンズ",  requiredScore: 50 },
 *   { name: "レギュラー", requiredScore: 0 },
 * ]
 */
export function determineRank(
  score: number,
  rankDefs: RankDefinition[]
): string {
  // スコア降順でソート（安全のため）
  const sorted = [...rankDefs].sort(
    (a, b) => b.requiredScore - a.requiredScore
  );

  for (const rank of sorted) {
    if (score >= rank.requiredScore) {
      return rank.name;
    }
  }

  // フォールバック: 最下位ランク
  return sorted[sorted.length - 1]?.name ?? "レギュラー";
}

/* ════════════════════════════════════════════
   4. 報酬計算
   ════════════════════════════════════════════ */

export interface PriceEntry {
  action: string;
  basePrice: number;
  score: number;
  /** ランク別加算額（上位ランクから順に） */
  rankBonus: number[];
}

/**
 * 確定ランクに基づいて報酬額を計算する。
 *
 * rankIndex: 0=最上位(プラチナ), ..., N=最下位(レギュラー)
 * rankBonus[i] は i 番目のランクの加算額。
 * 報酬 = 基本単価 + (確定ランクまでの累計加算額)
 *
 * 例: ゴールド(index=1)の場合
 *   報酬 = basePrice + rankBonus[4] + rankBonus[3] + rankBonus[2] + rankBonus[1]
 *   (レギュラー→ブロンズ→シルバー→ゴールドまでの加算を累計)
 */
export function calculateReward(
  entry: PriceEntry,
  rankIndex: number,
  totalRanks: number
): number {
  if (!isRewardEligible(entry.action)) {
    return 0;
  }

  let reward = entry.basePrice;

  // 最下位ランク(totalRanks-1)から確定ランク(rankIndex)まで加算
  for (let i = totalRanks - 1; i >= rankIndex; i--) {
    reward += entry.rankBonus[i] ?? 0;
  }

  return reward;
}
