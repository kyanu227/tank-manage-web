// Phase 1 骨組み + Phase 2-B-1 で getTanks のみ本実装。
// tanks コレクションへの薄いラッパ。業務遷移・削除は扱わない。

import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  type DocumentSnapshot,
  type QueryConstraint,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import type { TankDoc, RepositoryWriter } from "./types";

/**
 * Firestore のタンクドキュメントを TankDoc に正規化する。
 * getTank / getTanks の双方で同一変換を行うため、ここに集約する。
 * status / location / staff / type / note / logNote は String 化、
 * updatedAt / latestLogId / nextMaintenanceDate はそのまま透過する。
 */
function toTankDoc(snap: DocumentSnapshot | QueryDocumentSnapshot): TankDoc {
  const raw = snap.data() as any;
  return {
    id: snap.id,
    status: String(raw.status ?? ""),
    location: raw.location != null ? String(raw.location) : undefined,
    staff: raw.staff != null ? String(raw.staff) : undefined,
    type: raw.type != null ? String(raw.type) : undefined,
    note: raw.note != null ? String(raw.note) : undefined,
    logNote: raw.logNote != null ? String(raw.logNote) : undefined,
    updatedAt: raw.updatedAt,
    latestLogId: raw.latestLogId ?? undefined,
    nextMaintenanceDate: raw.nextMaintenanceDate,
  };
}

/** タンクのフィルタ条件（Phase 2 以降で拡張） */
export interface GetTanksOptions {
  status?: string;
  /** 複数ステータスのいずれかに合致するタンクを取得（例: 一括返却対象 [LENT, UNRETURNED]）。
   *  Firestore の `in` 句は最大10件。10件超は呼び出し側責任とし、ここでは分割しない。 */
  statusIn?: string[];
  location?: string;
  /** タンクIDの先頭アルファベット。Firestore でクエリしづらいため取得後にメモリでフィルタする。 */
  prefix?: string;
}

/** 業務遷移を伴わない単純な属性更新のパッチ。status/location/latestLogId は禁止。 */
export type TankFieldsPatch = Partial<
  Pick<TankDoc, "note" | "type" | "nextMaintenanceDate" | "logNote">
>;

/** tanks 購読の unsubscribe 関数 */
export type Unsubscribe = () => void;

/** 1件取得。存在しなければ null。 */
export async function getTank(tankId: string): Promise<TankDoc | null> {
  const snap = await getDoc(doc(db, "tanks", tankId));
  if (!snap.exists()) return null;
  return toTankDoc(snap);
}

/**
 * 全件または条件つき取得。
 * - options 未指定 → tanks 全件取得
 * - status / statusIn / location が指定されたら where 句で AND 絞り込み
 * - prefix は Firestore で表現しづらいため、取得後にクライアント側でフィルタする
 * - 戻り値は id 昇順（localeCompare）でソート済み
 */
export async function getTanks(options?: GetTanksOptions): Promise<TankDoc[]> {
  const tanksCol = collection(db, "tanks");
  const constraints: QueryConstraint[] = [];
  if (options?.status !== undefined) {
    constraints.push(where("status", "==", options.status));
  }
  if (options?.statusIn !== undefined && options.statusIn.length > 0) {
    constraints.push(where("status", "in", options.statusIn));
  }
  if (options?.location !== undefined) {
    constraints.push(where("location", "==", options.location));
  }

  const snap =
    constraints.length > 0
      ? await getDocs(query(tanksCol, ...constraints))
      : await getDocs(tanksCol);

  const list: TankDoc[] = [];
  snap.forEach((d) => {
    list.push(toTankDoc(d));
  });

  // prefix はクライアント側 filter（Firestore のクエリで先頭一致を表現しづらいため）
  const filtered =
    options?.prefix !== undefined
      ? list.filter((t) => {
          const m = t.id.match(/^([A-Z]+)/i);
          return m ? m[1].toUpperCase() === options.prefix!.toUpperCase() : false;
        })
      : list;

  filtered.sort((a, b) => a.id.localeCompare(b.id));
  return filtered;
}

/** onSnapshot 購読。戻り値は unsubscribe。 */
export function listenTanks(
  _callback: (tanks: TankDoc[]) => void,
  _options?: GetTanksOptions,
): Unsubscribe {
  throw new Error("not implemented in Phase 1");
}

/** 複数ID の一括取得（10件ごとの in 分割に対応）。 */
export async function getTanksByIds(_tankIds: string[]): Promise<TankDoc[]> {
  throw new Error("not implemented in Phase 1");
}

/**
 * 業務遷移を伴わない単純な属性更新。
 * 許容: note / type / nextMaintenanceDate などの表示用メタ情報。
 * 禁止: status / location / latestLogId / 貸出返却充填に伴う更新（tank-operation 経由）。
 */
export async function updateTankFields(
  _tankId: string,
  _patch: TankFieldsPatch,
): Promise<void> {
  throw new Error("not implemented in Phase 1");
}

/**
 * updateTankFields のバッチ/トランザクション参加版。
 * 許容/禁止範囲は updateTankFields と同じ。
 */
export function updateTankFieldsInBatch(
  _writer: RepositoryWriter,
  _tankId: string,
  _patch: TankFieldsPatch,
): void {
  throw new Error("not implemented in Phase 1");
}
