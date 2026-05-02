// 受注データモデル（items配列構造）
// 1発注 = 1 transactions ドキュメントに複数タンク種別を items[] で格納する。
// 旧スキーマ（tankType/quantity をスカラーで持つ）との後方互換も normalizeOrderDoc() で吸収する。

import type { DocumentData } from "firebase/firestore";

/** 受注アイテム（タンク種別ごとの明細） */
export type OrderItem = {
  tankType: string;
  quantity: number;
};

export type OrderStatus =
  | "pending"
  | "pending_approval"
  | "pending_link"
  | "approved"
  | "completed";

type TimestampLike = {
  toMillis: () => number;
};

/** Firestore transactions(type="order") を正規化したアプリ内表現 */
export type PendingOrder = {
  id: string;
  customerId: string;
  customerName: string;
  status: OrderStatus;
  items: OrderItem[];
  deliveryType?: "pickup" | "delivery";
  deliveryTargetName?: string;
  deliveryNote?: string;
  note?: string;
  createdByUid?: string;
  approvedBy?: string;
  approvedByStaffId?: string;
  approvedByStaffName?: string;
  approvedByStaffEmail?: string;
  fulfilledBy?: string;
  fulfilledByStaffId?: string;
  fulfilledByStaffName?: string;
  fulfilledByStaffEmail?: string;
  // Firestore Timestamp（UI側で toMillis() を呼び出す）
  createdAt: TimestampLike | undefined;
};

function normalizeOrderStatus(status: unknown): OrderStatus {
  if (
    status === "pending"
    || status === "pending_approval"
    || status === "pending_link"
    || status === "approved"
    || status === "completed"
  ) {
    return status;
  }
  return "pending";
}

/**
 * Firestoreの生データを PendingOrder に正規化する。
 * - 新スキーマ（items: [{tankType, quantity}, ...]）はそのまま使用
 * - 旧スキーマ（tankType: string, quantity: number のスカラー）は items 配列1件に変換
 * これにより、読み込み側は常に items 配列ベースで扱える。
 */
export function normalizeOrderDoc(
  id: string,
  data: DocumentData
): PendingOrder {
  const items: OrderItem[] =
    Array.isArray(data.items) && data.items.length > 0
      ? data.items.map((item: unknown) => {
          const itemRecord = item && typeof item === "object"
            ? item as Record<string, unknown>
            : {};
          return {
            tankType: String(itemRecord.tankType ?? ""),
            quantity: Number(itemRecord.quantity) || 0,
          };
        })
      : [
          {
            // 旧スキーマ互換: tankType/quantity スカラーを items 配列に変換
            tankType: String(data.tankType ?? ""),
            quantity: Number(data.quantity) || 0,
          },
        ];

  return {
    id,
    customerId: String(data.customerId ?? ""),
    customerName: String(data.customerName ?? data.customerNameInput ?? ""),
    status: normalizeOrderStatus(data.status),
    items,
    deliveryType: data.deliveryType === "delivery" || data.deliveryRequired === true ? "delivery" : "pickup",
    deliveryTargetName: String(data.deliveryTargetName ?? data.deliveryPlaceName ?? ""),
    deliveryNote: String(data.deliveryNote ?? ""),
    note: String(data.note ?? data.orderNote ?? data.deliveryNote ?? ""),
    createdByUid: String(data.createdByUid ?? ""),
    approvedBy: String(data.approvedBy ?? ""),
    approvedByStaffId: String(data.approvedByStaffId ?? ""),
    approvedByStaffName: String(data.approvedByStaffName ?? ""),
    approvedByStaffEmail: String(data.approvedByStaffEmail ?? ""),
    fulfilledBy: String(data.fulfilledBy ?? ""),
    fulfilledByStaffId: String(data.fulfilledByStaffId ?? ""),
    fulfilledByStaffName: String(data.fulfilledByStaffName ?? ""),
    fulfilledByStaffEmail: String(data.fulfilledByStaffEmail ?? ""),
    createdAt: data.createdAt,
  };
}

/**
 * タンクの type と items配列から、どの item にマッチするかを判定する。
 * 該当する種別が items に含まれていなければ null を返す。
 */
export function findMatchingItem(
  tankType: string,
  items: OrderItem[]
): OrderItem | null {
  return items.find((i) => i.tankType === tankType) ?? null;
}

/** items 配列の合計本数 */
export function totalOrderQuantity(items: OrderItem[]): number {
  return items.reduce((sum, i) => sum + (Number(i.quantity) || 0), 0);
}

/**
 * 表示用のサマリー文字列を生成する。
 * - 単一種別: "スチール10L × 3本"
 * - 複数種別: "合計5本（3種）"
 * UI側でそのまま採用するもよし、独自に itemsから組み立てるもよし。
 */
export function summarizeOrderItems(items: OrderItem[]): string {
  const total = totalOrderQuantity(items);
  if (items.length === 0) return "0本";
  if (items.length === 1) {
    const it = items[0];
    return `${it.tankType} × ${it.quantity}本`;
  }
  return `合計${total}本（${items.length}種）`;
}
