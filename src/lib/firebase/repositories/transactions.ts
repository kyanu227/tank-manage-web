// Phase 1 骨組み + Phase 2-B-7 で getOrders のみ本実装。
// transactions コレクションの作成・読み取り・更新を担う薄いラッパ。
// 旧スキーマ互換は repository 境界で正規化する。

import {
  collection,
  getDocs,
  query,
  where,
  type QueryConstraint,
} from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import { normalizeOrderDoc } from "@/lib/order-types";
import type {
  PendingOrder,
  RepositoryWriter,
  TransactionDoc,
} from "./types";

/** transactions 購読の unsubscribe 関数 */
export type Unsubscribe = () => void;

/** 作成入力（Phase 2 以降で type 別に union 化する可能性あり） */
export interface CreateTransactionInput {
  type: TransactionDoc["type"];
  status?: string;
  [key: string]: unknown;
}

export type TransactionPatch = Partial<Omit<TransactionDoc, "id">> & {
  [key: string]: unknown;
};

/** 発注取得オプション */
export interface GetOrdersOptions {
  status?: "pending" | "pending_approval" | "approved";
  customerId?: string;
  since?: unknown;
}

/** 返却取得オプション */
export interface GetReturnsOptions {
  status?: string;
  customerId?: string;
  since?: unknown;
}

/** 未充填報告取得オプション */
export interface GetUnchargedReportsOptions {
  status?: string;
  customerId?: string;
  since?: unknown;
}

/** 1件作成。createdAt / updatedAt は repository 側で自動付与する。 */
export async function createTransaction(
  _input: CreateTransactionInput,
): Promise<string> {
  throw new Error("not implemented in Phase 1");
}

/** 単純更新。updatedAt は repository 側で自動付与する。 */
export async function updateTransaction(
  _transactionId: string,
  _patch: TransactionPatch,
): Promise<void> {
  throw new Error("not implemented in Phase 1");
}

/** updateTransaction のバッチ/トランザクション参加版。 */
export function updateTransactionInBatch(
  _writer: RepositoryWriter,
  _transactionId: string,
  _patch: TransactionPatch,
): void {
  throw new Error("not implemented in Phase 1");
}

/** 1件取得。存在しなければ null。 */
export async function getTransaction(
  _transactionId: string,
): Promise<TransactionDoc | null> {
  throw new Error("not implemented in Phase 1");
}

/**
 * type == "order" のクエリ。正規化済み PendingOrder を返す。
 * - `type == "order"` を必須条件として常に付与する
 * - options?.status / options?.customerId は指定されたぶんだけ where を追加
 * - orderBy は付けない（呼び出し側でソートする方針）
 * - 戻り値は normalizeOrderDoc を通した PendingOrder[]
 *   （旧スキーマ tankType/quantity スカラーも吸収）
 *
 * NOTE: options?.since は Phase 後半で since 対応する（現状未対応）。
 */
export async function getOrders(
  options?: GetOrdersOptions,
): Promise<PendingOrder[]> {
  const constraints: QueryConstraint[] = [where("type", "==", "order")];
  if (options?.status !== undefined) {
    constraints.push(where("status", "==", options.status));
  }
  if (options?.customerId !== undefined) {
    constraints.push(where("customerId", "==", options.customerId));
  }
  // Phase 後半で since 対応（timestamp/createdAt の境界値クエリを追加予定）

  const snap = await getDocs(query(collection(db, "transactions"), ...constraints));
  const list: PendingOrder[] = [];
  snap.forEach((d) => {
    list.push(normalizeOrderDoc(d.id, d.data()));
  });
  return list;
}

/** type == "return" のクエリ。 */
export async function getReturns(
  _options?: GetReturnsOptions,
): Promise<TransactionDoc[]> {
  throw new Error("not implemented in Phase 1");
}

/** type == "uncharged_report" のクエリ。 */
export async function getUnchargedReports(
  _options?: GetUnchargedReportsOptions,
): Promise<TransactionDoc[]> {
  throw new Error("not implemented in Phase 1");
}

/** 受注画面用のスナップショット購読。 */
export function listenOrders(
  _status: "pending" | "pending_approval" | "approved",
  _callback: (orders: PendingOrder[]) => void,
): Unsubscribe {
  throw new Error("not implemented in Phase 1");
}

/** 返却承認待ち購読。 */
export function listenReturnApprovals(
  _callback: (returns: TransactionDoc[]) => void,
): Unsubscribe {
  throw new Error("not implemented in Phase 1");
}

/** 承認ショートカット（内部は update）。 */
export async function markOrderApproved(
  _orderId: string,
  _approvedBy: string,
): Promise<void> {
  throw new Error("not implemented in Phase 1");
}

/** 貸出完了と同 batch に参加するバッチ版。 */
export function markOrderCompletedInBatch(
  _writer: RepositoryWriter,
  _orderId: string,
  _fulfilledBy: string,
): void {
  throw new Error("not implemented in Phase 1");
}
