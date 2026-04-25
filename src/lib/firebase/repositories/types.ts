// Phase 1 骨組み。実装は Phase 2 以降。
// 各 repository が受け渡す DTO 型を集約する。
// 既存の TankDoc は src/lib/tank-types.ts の定義を再 export する。

import type { WriteBatch, Transaction, Timestamp } from "firebase/firestore";

// tanks
export type { TankDoc } from "../../tank-types";

/**
 * repositories の *InBatch 系が受け取る writer の最小共通型。
 * tank-operation.ts の TankOperationWriter もこの形に収まる想定。
 * Phase 2 以降、具体的な型を拡張する可能性あり。
 */
export type RepositoryWriter = WriteBatch | Transaction;

// logs
/**
 * logs コレクションのドキュメント共通型（Phase 1 最小版）。
 * 追記型 revision チェーンの正本は tank-operation.ts 側。ここでは
 * 読み取り・表示で使う最小限のフィールドのみを宣言する。
 * Phase 2 以降、必要に応じて拡張する。
 */
export interface LogDoc {
  id: string;
  logStatus: "active" | "superseded" | "voided";
  logKind: string;
  rootLogId: string;
  revision: number;
  tankId?: string;
  action?: string;
  status?: string;
  location?: string;
  staff?: string;
  note?: string;
  editReason?: string;
  /** 操作発生時刻。表示・期間集計の主軸。 */
  timestamp?: Timestamp;
  createdAt?: Timestamp;
  revisionCreatedAt?: Timestamp;
}

// transactions
/** transactions の type ディスクリミネータ */
export type TransactionType = "order" | "return" | "uncharged_report";

/**
 * transactions コレクションのドキュメント共通型（Phase 1 最小版）。
 * 正規化済みの型（PendingOrder など）は repository 境界で吸収する方針のため、
 * ここでは生ドキュメントとしての最小フィールドだけ宣言する。
 */
export interface TransactionDoc {
  id: string;
  type: TransactionType;
  status: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

// 受注用の正規化済み型は既存を再 export する
export type { PendingOrder, OrderItem } from "../../order-types";
