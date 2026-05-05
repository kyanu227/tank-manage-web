import { doc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import { tanksRepository } from "@/lib/firebase/repositories";
import type { OperationActor } from "@/lib/operation-context";
import { applyBulkTankOperations } from "@/lib/tank-operation";
import {
  ACTION,
  RETURN_TAG,
  resolveReturnAction,
  type ReturnTag,
  type TankAction,
} from "@/lib/tank-rules";

type ReturnCondition = "normal" | "unused" | "uncharged" | "keep";

type ReturnTagProcessingItem = {
  id: string;
  tankId: string;
  condition: ReturnCondition;
};

type ReturnTagProcessingGroup = {
  customerId: string;
  customerName: string;
  items: ReturnTagProcessingItem[];
};

type ReturnTagProcessingSelections = Record<
  string,
  { selected: boolean; condition: ReturnCondition } | undefined
>;

export async function processReturnTags(input: {
  group: ReturnTagProcessingGroup;
  selections: ReturnTagProcessingSelections;
  actor: OperationActor;
}): Promise<{ processedCount: number }> {
  const { group, selections, actor } = input;
  const selectedItems = group.items.filter((item) => selections[item.id]?.selected);
  if (selectedItems.length === 0) {
    throw new Error("処理するタンクを選択してください");
  }

  const context = {
    actor,
    customer: {
      customerId: group.customerId,
      customerName: group.customerName,
    },
  };

  const selectedData = await Promise.all(selectedItems.map(async (item) => {
    const appData = selections[item.id];
    const condition = appData?.condition ?? item.condition;
    const tag: ReturnTag =
      condition === "unused" ? RETURN_TAG.UNUSED
        : condition === "uncharged" ? RETURN_TAG.UNCHARGED
          : RETURN_TAG.NORMAL;
    const note = `[返却タグ処理] 顧客: ${group.customerName} (タグ:${condition})`;
    const tank = await tanksRepository.getTank(item.tankId);
    if (!tank) {
      throw new Error(`[${item.tankId}] タンクが存在しません`);
    }
    const currentStatus = tank.status ?? "";
    const transitionAction: TankAction = condition === "keep"
      ? ACTION.CARRY_OVER
      : resolveReturnAction(tag, currentStatus);
    const location = condition === "keep"
      ? tank.location || group.customerName
      : "倉庫";
    return { item, condition, note, currentStatus, transitionAction, location };
  }));

  await applyBulkTankOperations(
    selectedData.map(({ item, note, currentStatus, transitionAction, location }) => ({
      tankId: item.tankId,
      transitionAction,
      currentStatus,
      context,
      location,
      tankNote: note,
      logNote: note,
    })),
    (batch) => {
      selectedData.forEach(({ item, condition }) => {
        batch.update(doc(db, "transactions", item.id), {
          status: "completed",
          finalCondition: condition,
          fulfilledAt: serverTimestamp(),
          fulfilledBy: actor.staffName,
          fulfilledByStaffId: actor.staffId,
          fulfilledByStaffName: actor.staffName,
          ...(actor.staffEmail ? { fulfilledByStaffEmail: actor.staffEmail } : {}),
        });
      });
    },
  );

  return { processedCount: selectedItems.length };
}
