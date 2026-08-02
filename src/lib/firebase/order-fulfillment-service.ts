import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import type { OperationActor } from "@/lib/operation-context";
import {
  totalOrderQuantity,
  type PendingOrder,
} from "@/lib/order-types";
import {
  applyBulkTankOperations,
  type TankRecoveryConfirmationResolver,
  type TankOperationWriter,
} from "@/lib/tank-operation";
import { ACTION } from "@/lib/tank-rules";

type FulfillmentTank = {
  id: string;
};

type FulfillmentScannedTank = FulfillmentTank & {
  valid: boolean;
};

type FulfillmentTankMap = Record<string, {
  status?: string;
  type?: string;
} | undefined>;

export type FulfillmentValidationResult =
  | {
      ok: true;
      validTanks: FulfillmentScannedTank[];
    }
  | {
      ok: false;
      message: string;
    };

export function getOrderApprovalValidationError(
  order: Pick<PendingOrder, "customerId">,
): string | null {
  if (!order.customerId) {
    return "顧客に紐付いていない受注は承認できません。管理画面で紐付けてください。";
  }
  return null;
}

export function validateOrderFulfillment(input: {
  order: PendingOrder;
  scannedTanks: FulfillmentScannedTank[];
  allTanks: FulfillmentTankMap;
}): FulfillmentValidationResult {
  const { order, scannedTanks, allTanks } = input;
  const validTanks = scannedTanks.filter((tank) => tank.valid);
  const totalRequired = totalOrderQuantity(order.items);

  const scannedByType = new Map<string, number>();
  validTanks.forEach((tank) => {
    const tankType = allTanks[tank.id]?.type ?? "";
    scannedByType.set(tankType, (scannedByType.get(tankType) ?? 0) + 1);
  });
  const unmetItems = order.items.filter(
    (item) => (scannedByType.get(item.tankType) ?? 0) !== item.quantity
  );
  if (validTanks.length !== totalRequired || unmetItems.length > 0) {
    return {
      ok: false,
      message: `数量が一致しません (${validTanks.length}/${totalRequired})`,
    };
  }

  return { ok: true, validTanks };
}

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

export type FulfillOrderInput = {
  order: PendingOrder;
  validTanks: FulfillmentTank[];
  allTanks: FulfillmentTankMap;
  actor: OperationActor;
  recoveryConfirmationResolver?: TankRecoveryConfirmationResolver;
};

export async function fulfillOrder(input: FulfillOrderInput): Promise<void> {
  const {
    order,
    validTanks,
    allTanks,
    actor,
    recoveryConfirmationResolver,
  } = input;
  const orderNote = `受注ID: ${order.id}`;
  const context = {
    actor,
    customer: {
      customerId: order.customerId,
      customerName: order.customerName,
    },
    transactionId: order.id,
    source: "order_fulfillment" as const,
    workflow: "order" as const,
  };

  const operations = validTanks.map((tank) => ({
    tankId: tank.id,
    transitionAction: ACTION.LEND,
    logAction: "受注貸出",
    currentStatus: allTanks[tank.id]?.status ?? "",
    context,
    location: order.customerName,
    tankNote: orderNote,
    logNote: orderNote,
  }));
  const completeOrder = (batch: TankOperationWriter) => {
    batch.update(doc(db, "transactions", order.id), {
      status: "completed",
      fulfilledAt: serverTimestamp(),
      fulfilledBy: actor.staffName,
      fulfilledByStaffId: actor.staffId,
      fulfilledByStaffName: actor.staffName,
      ...(actor.staffEmail ? { fulfilledByStaffEmail: actor.staffEmail } : {}),
      updatedAt: serverTimestamp(),
    });
  };
  await applyBulkTankOperations(operations, completeOrder, {
    recoveryConfirmationResolver,
  });
}
