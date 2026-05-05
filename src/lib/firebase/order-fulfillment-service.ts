import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import type { OperationActor } from "@/lib/operation-context";

export async function approveOrder(
  orderId: string,
  actor: OperationActor,
): Promise<void> {
  await updateDoc(doc(db, "transactions", orderId), {
    status: "approved",
    approvedAt: serverTimestamp(),
    approvedBy: actor.staffName,
    approvedByStaffId: actor.staffId,
    approvedByStaffName: actor.staffName,
    ...(actor.staffEmail ? { approvedByStaffEmail: actor.staffEmail } : {}),
    updatedAt: serverTimestamp(),
  });
}
