// Phase 1 骨組み。実装は Phase 2 以降。
// logs コレクションの読み取り専用 repository。
// 書き込み（新規・編集・取消）は tank-operation.ts の API を通す。
// 画面・feature hooks からの書き込みは Phase を問わず禁止。

import {
  collection,
  getDocs,
  limit as fsLimit,
  orderBy,
  query,
  Timestamp,
  where,
  type QueryConstraint,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { db } from "../config";
import type { LogDoc } from "./types";

/** logs 購読の unsubscribe 関数 */
export type Unsubscribe = () => void;

/** active ログ取得オプション（設計書 L160 周辺の確定仕様）。 */
export interface GetActiveLogsOptions {
  from?: Date;
  to?: Date;
  limit?: number;
  location?: string;
  /**
   * orderBy 指定。
   * - 未指定 or "timestamp" → `orderBy("timestamp", "desc")` を付与（既定挙動）
   * - null → `orderBy` を付けない（timestamp フィールドを持たないログも取得対象になる）
   *
   * Firestore 仕様: `orderBy(field)` を指定すると、その field が存在しない
   * ドキュメントは結果から除外される。staff/dashboard のようにクライアント側で
   * `originalAt ?? timestamp` で再ソートする画面は、Firestore 側でソートする
   * 必要がないため null を指定して取りこぼしを防ぐ。
   */
  orderBy?: "timestamp" | null;
}

/** Firestore ドキュメント → LogDoc に正規化する。 */
function toLogDoc(snap: QueryDocumentSnapshot): LogDoc {
  const data = snap.data() as Record<string, unknown>;
  const status = (data.logStatus as LogDoc["logStatus"]) ?? "active";
  // Firestore ドキュメントが持つ追加フィールド（originalAt, prevTankSnapshot,
  // nextTankSnapshot, transitionAction, logNote, editedBy, voidedBy 等）を
  // 呼び出し側で利用可能にするため、生データをスプレッドで保持したうえで
  // LogDoc 必須フィールドを明示変換で上書きする。
  return {
    ...(data as Partial<LogDoc>),
    id: snap.id,
    logStatus: status,
    logKind: (data.logKind as string) ?? "",
    rootLogId: (data.rootLogId as string) ?? snap.id,
    revision: (data.revision as number) ?? 0,
    tankId: data.tankId as string | undefined,
    action: data.action as string | undefined,
    status: data.status as string | undefined,
    location: data.location as string | undefined,
    staff: data.staff as string | undefined,
    note: data.note as string | undefined,
    editReason: data.editReason as string | undefined,
    timestamp: data.timestamp as Timestamp | undefined,
    createdAt: data.createdAt as Timestamp | undefined,
    revisionCreatedAt: data.revisionCreatedAt as Timestamp | undefined,
  };
}

/** タンク単位の履歴取得オプション */
export interface GetLogsByTankOptions {
  logStatus?: "active" | "superseded" | "voided";
  limit?: number;
  before?: unknown;
  after?: unknown;
}

/** action 指定の履歴取得オプション */
export interface GetLogsByActionOptions {
  limit?: number;
  since?: unknown;
  until?: unknown;
}

/** 期間指定の履歴取得オプション */
export interface GetLogsInRangeOptions {
  action?: string;
  logStatus?: "active" | "superseded" | "voided";
  limit?: number;
}

/**
 * logStatus == "active" の汎用取得。時系列降順。
 * 設計書 L160 周辺の確定仕様。
 */
export async function getActiveLogs(
  options?: GetActiveLogsOptions,
): Promise<LogDoc[]> {
  const constraints: QueryConstraint[] = [
    where("logStatus", "==", "active"),
  ];
  if (options?.from) {
    constraints.push(where("timestamp", ">=", Timestamp.fromDate(options.from)));
  }
  if (options?.to) {
    constraints.push(where("timestamp", "<=", Timestamp.fromDate(options.to)));
  }
  if (options?.location) {
    constraints.push(where("location", "==", options.location));
  }
  // orderBy: undefined（既定）or "timestamp" → timestamp desc で並べる
  // orderBy: null → orderBy を付けない（timestamp 無しログの取りこぼし防止）
  if (options?.orderBy !== null) {
    constraints.push(orderBy("timestamp", "desc"));
  }
  if (options?.limit !== undefined) {
    constraints.push(fsLimit(options.limit));
  }
  const snap = await getDocs(query(collection(db, "logs"), ...constraints));
  return snap.docs.map(toLogDoc);
}

/** 1件取得。 */
export async function getLog(_logId: string): Promise<LogDoc | null> {
  throw new Error("not implemented in Phase 1");
}

/** タンク単位の履歴取得。 */
export async function getLogsByTank(
  _tankId: string,
  _options?: GetLogsByTankOptions,
): Promise<LogDoc[]> {
  throw new Error("not implemented in Phase 1");
}

/** logStatus == "active" の時系列降順。 */
export async function getActiveLogsByTank(
  _tankId: string,
  _limit?: number,
): Promise<LogDoc[]> {
  throw new Error("not implemented in Phase 1");
}

/** 最新 active ログ。tank-trace や編集可否判定で使う。 */
export async function getLatestActiveLogForTank(
  _tankId: string,
): Promise<LogDoc | null> {
  throw new Error("not implemented in Phase 1");
}

/** revision チェーン取得。 */
export async function getLogsByRoot(rootLogId: string): Promise<LogDoc[]> {
  const snap = await getDocs(
    query(collection(db, "logs"), where("rootLogId", "==", rootLogId)),
  );
  return snap.docs.map(toLogDoc);
}

/** action 指定の履歴（売上集計・trace の内部用）。 */
export async function getLogsByAction(
  _action: string,
  _options?: GetLogsByActionOptions,
): Promise<LogDoc[]> {
  throw new Error("not implemented in Phase 1");
}

/** 月次集計・請求書出力用の期間クエリ。 */
export async function getLogsInRange(
  _from: Date,
  _to: Date,
  _options?: GetLogsInRangeOptions,
): Promise<LogDoc[]> {
  throw new Error("not implemented in Phase 1");
}

/** 画面表示用の購読。 */
export function listenLogsByTank(
  _tankId: string,
  _callback: (logs: LogDoc[]) => void,
): Unsubscribe {
  throw new Error("not implemented in Phase 1");
}

/** ダッシュボード用の最新ログ購読。 */
export function listenRecentLogs(
  _callback: (logs: LogDoc[]) => void,
  _limit?: number,
): Unsubscribe {
  throw new Error("not implemented in Phase 1");
}
