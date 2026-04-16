/**
 * タンクトレーサビリティ
 *
 * 問題発生時に「誰が・いつ・何をしたか」を追跡する。
 * 常時一覧表示ではなく、問題タンク発生時のオンデマンド調査用。
 *
 * 主な用途:
 *   - 未充填返却 → 直前の充填者を特定 → 報酬自動取消
 *   - 未返却     → 貸出日・貸出先・担当者を特定
 *   - 破損       → 直前に操作した人を特定
 */

import {
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  type Firestore,
} from "firebase/firestore";

/* ════════════════════════════════════════════
   1. 型定義
   ════════════════════════════════════════════ */

export interface TankLog {
  id: string;
  tankId: string;
  action: string;
  staffName: string;
  staffId?: string;
  location: string;
  prevLocation?: string;
  timestamp: Date;
  note?: string;
}

export interface TraceResult {
  /** 特定された責任者 */
  responsibleStaff: string;
  /** 責任者のログエントリ */
  sourceLog: TankLog;
  /** 調査対象のログエントリ（問題が発覚したログ） */
  triggerLog: TankLog;
}

/* ════════════════════════════════════════════
   2. 未充填の充填者特定
   ════════════════════════════════════════════ */

/**
 * 未充填返却が発生した場合、そのタンクを最後に充填した人を特定する。
 *
 * ロジック:
 *   1. 未充填返却のログからtankIdを取得
 *   2. そのtankIdの「充填」ログを時系列降順で検索
 *   3. 未充填返却より前の直近の充填ログ = 責任者
 */
export async function traceUnderfilledSource(
  db: Firestore,
  triggerLog: TankLog
): Promise<TraceResult | null> {
  const logsRef = collection(db, "logs");
  const q = query(
    logsRef,
    where("tankId", "==", triggerLog.tankId),
    where("action", "==", "充填"),
    where("timestamp", "<", triggerLog.timestamp),
    orderBy("timestamp", "desc"),
    limit(1)
  );

  const snap = await getDocs(q);
  if (snap.empty) return null;

  const doc = snap.docs[0];
  const data = doc.data();
  const sourceLog: TankLog = {
    id: doc.id,
    tankId: data.tankId,
    action: data.action,
    staffName: data.staffName,
    staffId: data.staffId,
    location: data.location,
    timestamp: data.timestamp?.toDate?.() ?? new Date(data.timestamp),
    note: data.note,
  };

  return {
    responsibleStaff: sourceLog.staffName,
    sourceLog,
    triggerLog,
  };
}

/* ════════════════════════════════════════════
   3. 未返却タンクの貸出元特定
   ════════════════════════════════════════════ */

/**
 * 未返却タンクについて、元の貸出ログを特定する。
 *
 * ロジック:
 *   そのtankIdの最新の「貸出」ログを取得
 *   → 貸出先・担当者・経過日数がわかる
 */
export async function traceUnreturnedSource(
  db: Firestore,
  tankId: string
): Promise<{
  lendLog: TankLog;
  destination: string;
  staffName: string;
  daysSinceLend: number;
} | null> {
  const logsRef = collection(db, "logs");
  const q = query(
    logsRef,
    where("tankId", "==", tankId),
    where("action", "==", "貸出"),
    orderBy("timestamp", "desc"),
    limit(1)
  );

  const snap = await getDocs(q);
  if (snap.empty) return null;

  const doc = snap.docs[0];
  const data = doc.data();
  const timestamp = data.timestamp?.toDate?.() ?? new Date(data.timestamp);

  const lendLog: TankLog = {
    id: doc.id,
    tankId: data.tankId,
    action: data.action,
    staffName: data.staffName,
    staffId: data.staffId,
    location: data.location,
    timestamp,
    note: data.note,
  };

  const daysSinceLend = Math.floor(
    (Date.now() - timestamp.getTime()) / (1000 * 60 * 60 * 24)
  );

  return {
    lendLog,
    destination: data.location,
    staffName: data.staffName,
    daysSinceLend,
  };
}

/* ════════════════════════════════════════════
   4. タンクの直前操作者を特定
   ════════════════════════════════════════════ */

/**
 * あるタンクの直前の操作ログを取得する。
 * 破損報告時に「最後に触った人」を特定するのに使う。
 */
export async function getLastOperation(
  db: Firestore,
  tankId: string,
  beforeTimestamp?: Date
): Promise<TankLog | null> {
  const logsRef = collection(db, "logs");

  const constraints = [
    where("tankId", "==", tankId),
    orderBy("timestamp", "desc"),
    limit(1),
  ];

  // 特定時刻より前のログを探す場合
  if (beforeTimestamp) {
    constraints.splice(1, 0, where("timestamp", "<", beforeTimestamp));
  }

  const q = query(logsRef, ...constraints);
  const snap = await getDocs(q);
  if (snap.empty) return null;

  const doc = snap.docs[0];
  const data = doc.data();

  return {
    id: doc.id,
    tankId: data.tankId,
    action: data.action,
    staffName: data.staffName,
    staffId: data.staffId,
    location: data.location,
    prevLocation: data.prevLocation,
    timestamp: data.timestamp?.toDate?.() ?? new Date(data.timestamp),
    note: data.note,
  };
}

/* ════════════════════════════════════════════
   5. タンク履歴取得（オンデマンド調査用）
   ════════════════════════════════════════════ */

/**
 * 指定タンクの操作履歴を時系列で取得する。
 * 問題が起きた時にタンクの全人生を追うための関数。
 *
 * @param maxEntries 最大取得件数（デフォルト50）
 */
export async function getTankHistory(
  db: Firestore,
  tankId: string,
  maxEntries: number = 50
): Promise<TankLog[]> {
  const logsRef = collection(db, "logs");
  const q = query(
    logsRef,
    where("tankId", "==", tankId),
    orderBy("timestamp", "desc"),
    limit(maxEntries)
  );

  const snap = await getDocs(q);

  return snap.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      tankId: data.tankId,
      action: data.action,
      staffName: data.staffName,
      staffId: data.staffId,
      location: data.location,
      prevLocation: data.prevLocation,
      timestamp: data.timestamp?.toDate?.() ?? new Date(data.timestamp),
      note: data.note,
    };
  });
}
