/**
 * タンク操作の一元化モジュール
 *
 * 全ページから呼ばれる唯一のタンク状態更新経路。
 * status の書き換えとログ書き込みを必ずペアで・原子的に行うことで、
 * 「ログなしの状態変更」を構造的に不可能にする。
 *
 * 使い分け:
 *   - applyTankOperation()        単一タンク・即 commit
 *   - appendTankOperation()       WriteBatch に追記（複数タンク・外部書き込みと統合）
 *   - applyBulkTankOperations()   複数タンク + 追加書き込みを原子化する便利関数
 *   - voidLog()                   ログの論理削除（物理削除はしない）
 */

import {
  collection,
  doc,
  serverTimestamp,
  writeBatch,
  type WriteBatch,
  type DocumentReference,
} from "firebase/firestore";
import { db } from "./firebase/config";
import {
  validateTransition,
  getNextStatus,
  type TankAction,
} from "./tank-rules";

/* ════════════════════════════════════════════
   型定義
   ════════════════════════════════════════════ */

export interface TankOperationInput {
  /** タンク ID */
  tankId: string;

  /** 遷移ルールを決める action（OP_RULES のキー）。
   *  例: ACTION.LEND, ACTION.RETURN, ACTION.IN_HOUSE_USE など */
  transitionAction: TankAction;

  /** ログに記録する操作名。省略時は transitionAction と同じ。
   *  例: 遷移は LEND だが、ログには "受注貸出" と記録したい場合に使う */
  logAction?: string;

  /** 現在のタンクステータス（バリデーション・prevStatus ログ用）。
   *  未知の場合は空文字で OK（破損報告など allowedPrev=[] の操作）。 */
  currentStatus?: string;

  /** 操作を行ったスタッフ名 */
  staff: string;

  /** 遷移後の場所。省略時は "倉庫" */
  location?: string;

  /** タンクドキュメントに記録する logNote（タグ情報など）。省略時は空。 */
  tankNote?: string;

  /** ログドキュメントに記録する note（自由メモ）。省略時は空。 */
  logNote?: string;

  /** ログに追加したい任意フィールド（customerId など） */
  logExtra?: Record<string, unknown>;

  /** タンクドキュメントに追加したい任意フィールド */
  tankExtra?: Record<string, unknown>;

  /** バリデーションをスキップする（旧データ救済など特殊ケース用） */
  skipValidation?: boolean;
}

export interface TankOperationResult {
  tankId: string;
  nextStatus: string;
  logRef: DocumentReference;
  tankRef: DocumentReference;
}

/* ════════════════════════════════════════════
   コア: batch に積む
   ════════════════════════════════════════════ */

/**
 * WriteBatch にタンク操作（status 更新 + ログ書き込み）を追記する。
 * commit は呼び出し側で行う。
 *
 * 用途: 複数タンクの一括処理、transactions 等の他コレクション更新と統合したい場合。
 */
export function appendTankOperation(
  batch: WriteBatch,
  input: TankOperationInput
): TankOperationResult {
  // バリデーション
  if (!input.skipValidation) {
    const currentStatus = input.currentStatus ?? "";
    const v = validateTransition(currentStatus, input.transitionAction);
    if (!v.ok) {
      throw new Error(`[${input.tankId}] ${v.reason}`);
    }
  }

  const nextStatus = getNextStatus(input.transitionAction);
  const location = input.location ?? "倉庫";
  const logAction = input.logAction ?? input.transitionAction;

  // タンク更新
  const tankRef = doc(db, "tanks", input.tankId);
  batch.set(
    tankRef,
    {
      status: nextStatus,
      location,
      staff: input.staff,
      updatedAt: serverTimestamp(),
      logNote: input.tankNote ?? "",
      ...(input.tankExtra ?? {}),
    },
    { merge: true }
  );

  // ログ書き込み（voided: false を必ず付与）
  const logRef = doc(collection(db, "logs"));
  batch.set(logRef, {
    tankId: input.tankId,
    action: logAction,
    prevStatus: input.currentStatus ?? "",
    newStatus: nextStatus,
    location,
    staff: input.staff,
    note: input.logNote ?? "",
    timestamp: serverTimestamp(),
    voided: false,
    ...(input.logExtra ?? {}),
  });

  return {
    tankId: input.tankId,
    nextStatus,
    logRef,
    tankRef,
  };
}

/* ════════════════════════════════════════════
   単一操作
   ════════════════════════════════════════════ */

/**
 * 単一タンクの操作を原子的に実行する。
 */
export async function applyTankOperation(
  input: TankOperationInput
): Promise<TankOperationResult & { logId: string }> {
  const batch = writeBatch(db);
  const result = appendTankOperation(batch, input);
  await batch.commit();
  return { ...result, logId: result.logRef.id };
}

/* ════════════════════════════════════════════
   一括操作（追加書き込み可能）
   ════════════════════════════════════════════ */

/**
 * 複数タンクの操作を一括実行する。
 * 追加の batch 書き込み（transactions の完了記録など）を extraOps で受ける。
 *
 * 例:
 *   await applyBulkTankOperations(inputs, (batch) => {
 *     batch.update(doc(db, "transactions", orderId), { status: "completed" });
 *   });
 */
export async function applyBulkTankOperations(
  inputs: TankOperationInput[],
  extraOps?: (batch: WriteBatch) => void
): Promise<TankOperationResult[]> {
  const batch = writeBatch(db);
  const results = inputs.map((input) => appendTankOperation(batch, input));
  if (extraOps) extraOps(batch);
  await batch.commit();
  return results;
}

/* ════════════════════════════════════════════
   論理削除（ログの void 化）
   ════════════════════════════════════════════ */

export interface VoidLogInput {
  /** 論理削除対象のログ ID */
  logId: string;
  /** 実行者名 */
  voidedBy: string;
  /** 取消理由（任意） */
  reason?: string;
  /** タンクステータスを巻き戻す場合の設定 */
  rollbackTank?: {
    tankId: string;
    toStatus: string;
    toLocation: string;
  };
}

/**
 * ログを論理削除する（物理削除はしない）。
 *
 * - logs/{id} に voided: true, voidedAt, voidedBy, voidReason を付与
 * - 必要なら tanks/{tankId} の status/location を巻き戻す
 * - delete_history に監査記録を残す
 *
 * 物理削除と違い、後から「本当に取り消されたログか・誰が取り消したか」を追える。
 */
export async function voidLog(input: VoidLogInput): Promise<void> {
  const batch = writeBatch(db);

  // 1. ログに voided フラグを立てる
  const logRef = doc(db, "logs", input.logId);
  batch.update(logRef, {
    voided: true,
    voidedAt: serverTimestamp(),
    voidedBy: input.voidedBy,
    voidReason: input.reason ?? "",
  });

  // 2. タンクステータスを巻き戻す（指定時のみ）
  if (input.rollbackTank) {
    batch.set(
      doc(db, "tanks", input.rollbackTank.tankId),
      {
        status: input.rollbackTank.toStatus,
        location: input.rollbackTank.toLocation,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  }

  // 3. 監査履歴を残す
  batch.set(doc(collection(db, "delete_history")), {
    type: "void",
    logId: input.logId,
    tankId: input.rollbackTank?.tankId ?? null,
    voidedBy: input.voidedBy,
    reason: input.reason ?? "",
    voidedAt: serverTimestamp(),
    rolledBack: !!input.rollbackTank,
    rollbackStatus: input.rollbackTank?.toStatus ?? null,
    rollbackLocation: input.rollbackTank?.toLocation ?? null,
  });

  await batch.commit();
}
