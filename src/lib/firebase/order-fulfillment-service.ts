import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import type { OperationActor } from "@/lib/operation-context";
import type { PendingOrder } from "@/lib/order-types";
import { applyBulkTankOperations } from "@/lib/tank-operation";
import { ACTION } from "@/lib/tank-rules";

type FulfillmentTank = {
  id: string;
};

type FulfillmentTankMap = Record<string, { status?: string } | undefined>;

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

export async function fulfillOrder(input: {
  order: PendingOrder;
  validTanks: FulfillmentTank[];
  allTanks: FulfillmentTankMap;
  actor: OperationActor;
}): Promise<void> {
  const { order, validTanks, allTanks, actor } = input;
  const orderNote = `受注ID: ${order.id}`;
  const context = {
    actor,
    customer: {
      customerId: order.customerId,
      customerName: order.customerName,
    },
  };

  await applyBulkTankOperations(
    validTanks.map((tank) => ({
      tankId: tank.id,
      transitionAction: ACTION.LEND,
      logAction: "受注貸出",
      currentStatus: allTanks[tank.id]?.status ?? "",
      context,
      location: order.customerName,
      tankNote: orderNote,
      logNote: orderNote,
    })),
    (batch) => {
      batch.update(doc(db, "transactions", order.id), {
        status: "completed",
        fulfilledAt: serverTimestamp(),
        fulfilledBy: actor.staffName,
        fulfilledByStaffId: actor.staffId,
        fulfilledByStaffName: actor.staffName,
        ...(actor.staffEmail ? { fulfilledByStaffEmail: actor.staffEmail } : {}),
        updatedAt: serverTimestamp(),
      });
    },
  );
}
