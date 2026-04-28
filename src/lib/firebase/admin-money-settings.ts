import { collection, doc, getDocs, serverTimestamp, writeBatch, type DocumentData } from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import { assertNotChangedSinceLoad, createDocId, hasFieldChanges, isNewDocId } from "@/lib/firebase/diff-write";

export interface AdminPriceRow {
  uid: string;
  action: string;
  base: number | string;
  score: number | string;
}

export interface AdminRankRow {
  uid: string;
  name: string;
  minScore: number | string;
}

export interface SaveAdminMoneySettingsInput {
  prices: AdminPriceRow[];
  ranks: AdminRankRow[];
  dirtyPriceIds: string[];
  deletedPriceIds: string[];
  dirtyRankIds: string[];
  deletedRankIds: string[];
}

export async function saveAdminMoneySettings({
  prices,
  ranks,
  dirtyPriceIds,
  deletedPriceIds,
  dirtyRankIds,
  deletedRankIds,
}: SaveAdminMoneySettingsInput): Promise<void> {
  const batch = writeBatch(db);

  const priceSnap = await getDocs(collection(db, "priceMaster"));
  const currentPrices = new Map(priceSnap.docs.map((d) => [d.id, d.data()]));
  deletedPriceIds.forEach((id) => batch.delete(doc(db, "priceMaster", id)));

  prices.forEach((price) => {
    const id = isNewDocId(price.uid) ? createDocId("price") : price.uid;
    const ref = doc(db, "priceMaster", id);
    const payload = {
      action: price.action.trim(),
      base: Number(price.base),
      score: Number(price.score),
    };

    if (isNewDocId(price.uid)) {
      batch.set(ref, { ...payload, updatedAt: serverTimestamp() });
      return;
    }

    if (!dirtyPriceIds.includes(price.uid)) return;

    const current = currentPrices.get(id);
    if (!current) {
      throw new Error(`単価「${price.action || id}」は他の操作で削除されています。再読込してください。`);
    }

    assertNotChangedSinceLoad(price as unknown as DocumentData, current, `単価「${price.action || id}」`);
    if (hasFieldChanges(current, payload)) {
      batch.update(ref, { ...payload, updatedAt: serverTimestamp() });
    }
  });

  const rankSnap = await getDocs(collection(db, "rankMaster"));
  const currentRanks = new Map(rankSnap.docs.map((d) => [d.id, d.data()]));
  deletedRankIds.forEach((id) => batch.delete(doc(db, "rankMaster", id)));

  ranks.forEach((rank) => {
    const id = isNewDocId(rank.uid) ? createDocId("rank") : rank.uid;
    const ref = doc(db, "rankMaster", id);
    const payload = {
      name: rank.name.trim(),
      minScore: Number(rank.minScore),
    };

    if (isNewDocId(rank.uid)) {
      batch.set(ref, { ...payload, updatedAt: serverTimestamp() });
      return;
    }

    if (!dirtyRankIds.includes(rank.uid)) return;

    const current = currentRanks.get(id);
    if (!current) {
      throw new Error(`ランク「${rank.name || id}」は他の操作で削除されています。再読込してください。`);
    }

    assertNotChangedSinceLoad(rank as unknown as DocumentData, current, `ランク「${rank.name || id}」`);
    if (hasFieldChanges(current, payload)) {
      batch.update(ref, { ...payload, updatedAt: serverTimestamp() });
    }
  });

  await batch.commit();
}
