import { doc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase/config";

export async function updateLogNote(
  tankId: string,
  logNote: string,
): Promise<void> {
  await updateDoc(doc(db, "tanks", tankId), { logNote });
}
