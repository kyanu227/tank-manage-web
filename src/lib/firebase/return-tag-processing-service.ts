import { doc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import { tanksRepository } from "@/lib/firebase/repositories";
import type {
  OperationActor,
  OperationContext,
  ReturnCondition,
} from "@/lib/operation-context";
import { conditionToReturnTag, returnTagToReturnCondition } from "@/lib/return-tag-rules";
import { tryParseTankId } from "@/lib/tank-id";
import { applyBulkTankOperations } from "@/lib/tank-operation";
import {
  ACTION,
  RETURN_TAG,
  resolveReturnAction,
  type TankAction,
} from "@/lib/tank-rules";

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

  const baseContext: OperationContext = {
    actor,
    customer: {
      customerId: group.customerId,
      customerName: group.customerName,
    },
    source: "return_tag_processing",
    workflow: "return",
  };

  const selectedData = await Promise.all(selectedItems.map(async (item) => {
    const tankIdResult = tryParseTankId(item.tankId);
    if (!tankIdResult.ok) {
      throw new Error(`[${item.tankId}] ${tankIdResult.reason}`);
    }
    const tankId = tankIdResult.canonicalTankId;
    const appData = selections[item.id];
    const tag = conditionToReturnTag(appData?.condition ?? item.condition);
    const condition = returnTagToReturnCondition(tag);
    const note = `[返却タグ処理] 顧客: ${group.customerName} (タグ:${condition})`;
    const tank = await tanksRepository.getTank(tankId);
    if (!tank) {
      throw new Error(`[${tankId}] タンクが存在しません`);
    }
    const currentStatus = tank.status ?? "";
    const isKeep = tag === RETURN_TAG.KEEP;
    const transitionAction: TankAction = isKeep
      ? ACTION.CARRY_OVER
      : resolveReturnAction(tag, currentStatus);
    const location = isKeep
      ? tank.location || group.customerName
      : "倉庫";
    return { item, tankId, condition, note, currentStatus, transitionAction, location };
  }));

  await applyBulkTankOperations(
    selectedData.map(({ item, tankId, condition, note, currentStatus, transitionAction, location }) => ({
      tankId,
      transitionAction,
      currentStatus,
      context: {
        ...baseContext,
        transactionId: item.id,
        returnCondition: condition,
      },
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
