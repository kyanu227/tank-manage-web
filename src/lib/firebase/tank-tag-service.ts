import { doc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import { returnTagToStoredLogNote, type ReturnTag } from "@/lib/return-tag-rules";

export async function updateLogNote(
  tankId: string,
  logNote: string,
): Promise<void> {
  await updateDoc(doc(db, "tanks", tankId), { logNote });
}

/** tanks.logNote の返却タグ marker だけを更新する。状態遷移・logs・transactions は扱わない。 */
export async function updateTankReturnTagMarker(
  tankId: string,
  tag: ReturnTag,
): Promise<void> {
  await updateLogNote(tankId, returnTagToStoredLogNote(tag));
}
