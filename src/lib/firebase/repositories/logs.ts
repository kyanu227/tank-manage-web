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

/** staffId / customerId など identity field で active ログを取得するオプション。 */
export interface GetActiveLogsByIdentityOptions {
  from?: Date;
  to?: Date;
  limit?: number;
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
    staffId: data.staffId as string | undefined,
    staffName: data.staffName as string | undefined,
    staffEmail: data.staffEmail as string | undefined,
    customerId: data.customerId as string | undefined,
    customerName: data.customerName as string | undefined,
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

/**
 * staffId で active ログを取得する。時系列降順。
 * 必要 index: logs(logStatus Asc, staffId Asc, timestamp Desc, __name__ Desc)
 */
export async function getActiveLogsByStaffId(
  staffId: string,
  options?: GetActiveLogsByIdentityOptions,
): Promise<LogDoc[]> {
  return getActiveLogsByField("staffId", staffId, options);
}

/**
 * customerId で active ログを取得する。時系列降順。
 * 必要 index: logs(logStatus Asc, customerId Asc, timestamp Desc, __name__ Desc)
 */
export async function getActiveLogsByCustomerId(
  customerId: string,
  options?: GetActiveLogsByIdentityOptions,
): Promise<LogDoc[]> {
  return getActiveLogsByField("customerId", customerId, options);
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

/**
 * tankId で active ログを取得する。時系列降順。
 * 必要 index: logs(logStatus Asc, tankId Asc, timestamp Desc, __name__ Desc)
 */
export async function getActiveLogsByTank(
  tankId: string,
  limit?: number,
): Promise<LogDoc[]> {
  return getActiveLogsByField("tankId", tankId, { limit });
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

type ActiveLogIdentityField = "staffId" | "customerId" | "tankId";

async function getActiveLogsByField(
  field: ActiveLogIdentityField,
  value: string,
  options?: GetActiveLogsByIdentityOptions,
): Promise<LogDoc[]> {
  const normalizedValue = value.trim();
  if (!normalizedValue) return [];

  const constraints: QueryConstraint[] = [
    where("logStatus", "==", "active"),
    where(field, "==", normalizedValue),
  ];
  if (options?.from) {
    constraints.push(where("timestamp", ">=", Timestamp.fromDate(options.from)));
  }
  if (options?.to) {
    constraints.push(where("timestamp", "<=", Timestamp.fromDate(options.to)));
  }
  constraints.push(orderBy("timestamp", "desc"));
  if (options?.limit !== undefined) {
    constraints.push(fsLimit(options.limit));
  }

  const snap = await getDocs(query(collection(db, "logs"), ...constraints));
  return snap.docs.map(toLogDoc);
}
