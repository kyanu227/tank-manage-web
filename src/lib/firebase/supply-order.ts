import {
  collection,
  doc,
  serverTimestamp,
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

export async function submitSupplyOrder(
  input: SubmitSupplyOrderInput,
): Promise<SubmitSupplyOrderResult> {
  const actor = normalizeActor(input.actor);
  const items = input.items.map((item) => ({
    name: String(item.name || "").trim(),
    count: Number(item.count),
    price: Number(item.price) || 0,
  }));

  if (items.length === 0) {
    throw new Error("発注する品目を選択してください");
  }

  items.forEach((item) => {
    if (!item.name) throw new Error("品目名を取得できませんでした");
    if (!Number.isFinite(item.count) || item.count <= 0) {
      throw new Error(`${item.name} の数量が不正です`);
    }
  });

  const total = items.reduce((sum, item) => sum + item.price * item.count, 0);
  const timestamp = serverTimestamp();
  const batch = writeBatch(db);

  items.forEach((item) => {
    batch.set(doc(collection(db, "orders")), {
      name: item.name,
      count: item.count,
      price: item.price,
      total: item.price * item.count,
      staff: actor.staffName,
      timestamp,
    });
  });

  batch.set(doc(collection(db, "logs")), {
    tankId: "-",
    action: "資材発注",
    newStatus: "-",
    location: "-",
    staffId: actor.staffId,
    staffName: actor.staffName,
    ...(actor.staffEmail ? { staffEmail: actor.staffEmail } : {}),
    note: items.map((item) => `${item.name}×${item.count}`).join(", "),
    logStatus: "active",
    logKind: "order",
    timestamp,
  });

  await batch.commit();
  return { itemCount: items.length, total };
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
