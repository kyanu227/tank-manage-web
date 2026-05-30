import {
  collection,
  doc,
  serverTimestamp,
  type DocumentData,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import type { OperationActor } from "@/lib/operation-context";

export interface SupplyOrderItem {
  name: string;
  count: number;
  price: number;
}

export interface SubmitSupplyOrderInput {
  items: SupplyOrderItem[];
  actor: OperationActor;
}

export interface SubmitSupplyOrderResult {
  itemCount: number;
  total: number;
}

type NormalizedSupplyOrder = {
  items: SupplyOrderItem[];
  actor: OperationActor;
  total: number;
};

export async function submitSupplyOrder(
  input: SubmitSupplyOrderInput,
): Promise<SubmitSupplyOrderResult> {
  const order = normalizeSupplyOrder(input);
  validateSupplyOrder(order);
  const timestamp = serverTimestamp();
  const batch = writeBatch(db);

  // supply-order は資材発注用の orders であり、顧客タンク発注 transactions(type="order") とは分ける。
  order.items.forEach((item) => {
    batch.set(doc(collection(db, "orders")), buildSupplyOrderItemPayload(item, order.actor, timestamp));
  });

  batch.set(doc(collection(db, "logs")), buildSupplyOrderLogPayload(order, timestamp));

  await batch.commit();
  return { itemCount: order.items.length, total: order.total };
}

function normalizeSupplyOrder(input: SubmitSupplyOrderInput): NormalizedSupplyOrder {
  const actor = normalizeActor(input.actor);
  const items = input.items.map((item) => ({
    name: String(item.name || "").trim(),
    count: Number(item.count),
    price: Number(item.price) || 0,
  }));
  const total = items.reduce((sum, item) => sum + item.price * item.count, 0);

  return {
    items,
    actor,
    total,
  };
}

function validateSupplyOrder(order: NormalizedSupplyOrder): void {
  if (order.items.length === 0) {
    throw new Error("発注する品目を選択してください");
  }

  order.items.forEach((item) => {
    if (!item.name) throw new Error("品目名を取得できませんでした");
    if (!Number.isFinite(item.count) || item.count <= 0) {
      throw new Error(`${item.name} の数量が不正です`);
    }
  });
}

function buildSupplyOrderItemPayload(
  item: SupplyOrderItem,
  actor: OperationActor,
  timestamp: unknown,
): DocumentData {
  return {
    name: item.name,
    count: item.count,
    price: item.price,
    total: item.price * item.count,
    staff: actor.staffName,
    timestamp,
  };
}

function buildSupplyOrderLogPayload(
  order: NormalizedSupplyOrder,
  timestamp: unknown,
): DocumentData {
  return {
    tankId: "-",
    action: "資材発注",
    newStatus: "-",
    location: "-",
    staffId: order.actor.staffId,
    staffName: order.actor.staffName,
    ...(order.actor.staffEmail ? { staffEmail: order.actor.staffEmail } : {}),
    note: buildSupplyOrderLogNote(order.items),
    logStatus: "active",
    logKind: "order",
    timestamp,
  };
}

function buildSupplyOrderLogNote(items: SupplyOrderItem[]): string {
  return items.map((item) => `${item.name}×${item.count}`).join(", ");
}

function normalizeActor(actor: OperationActor): OperationActor {
  const staffId = String(actor?.staffId || "").trim();
  const staffName = String(actor?.staffName || "").trim();
  const staffEmail = String(actor?.staffEmail || "").trim();

  if (!staffId || !staffName) {
    throw new Error("操作者を取得できませんでした");
  }

  return {
    staffId,
    staffName,
    ...(staffEmail ? { staffEmail } : {}),
  };
}
