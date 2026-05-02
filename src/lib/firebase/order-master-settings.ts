import { collection, doc, getDocs, serverTimestamp, writeBatch, type DocumentData } from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import { assertNotChangedSinceLoad, createDocId, hasFieldChanges, isNewDocId } from "@/lib/firebase/diff-write";

export interface OrderMasterItem {
  id: string;
  category: "tank" | "supply";
  colA: string;
  colB: string;
  price: number | string;
}

export interface SaveOrderItemsInput {
  items: OrderMasterItem[];
  dirty: string[];
  deleted: string[];
}

export async function listOrderItems(): Promise<OrderMasterItem[]> {
  const snap = await getDocs(collection(db, "orderMaster"));
  const items: OrderMasterItem[] = [];
  snap.forEach((d) => items.push({ id: d.id, ...d.data() } as OrderMasterItem));
  return items;
}

export async function saveOrderItems({
  items,
  dirty,
  deleted,
}: SaveOrderItemsInput): Promise<void> {
  const batch = writeBatch(db);
  const orderSnap = await getDocs(collection(db, "orderMaster"));
  const currentOrders = new Map(orderSnap.docs.map((d) => [d.id, d.data()]));

  deleted.forEach((id) => {
    batch.delete(doc(db, "orderMaster", id));
  });

  items.forEach((item) => {
    const docId = isNewDocId(item.id) ? createDocId("order") : item.id;
    const ref = doc(db, "orderMaster", docId);
    const payload = {
      category: item.category,
      colA: String(item.colA).trim(),
      colB: item.colB.trim(),
      price: Number(item.price),
    };

    if (isNewDocId(item.id)) {
      batch.set(ref, {
        ...payload,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      return;
    }

    if (!dirty.includes(item.id)) return;

    const current = currentOrders.get(docId);
    if (!current) {
      throw new Error(`発注品目「${item.colB || item.id}」は他の操作で削除されています。再読込してください。`);
    }

    assertNotChangedSinceLoad(item as unknown as DocumentData, current, `発注品目「${item.colB || item.id}」`);
    if (hasFieldChanges(current, payload)) {
      batch.update(ref, {
        ...payload,
        updatedAt: serverTimestamp(),
      });
    }
  });

  await batch.commit();
}
