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
import {
  applyBulkTankOperations,
  type TankOperationInput,
  type TankOperationWriter,
} from "@/lib/tank-operation";
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

type ReturnConfirmation = {
  item: ReturnTagProcessingItem;
  tankId: string;
  condition: ReturnCondition;
  note: string;
  currentStatus: string;
  transitionAction: TankAction;
  location: string;
};

export async function processReturnTags(input: {
  group: ReturnTagProcessingGroup;
  selections: ReturnTagProcessingSelections;
  actor: OperationActor;
}): Promise<{ processedCount: number }> {
  const { group, selections, actor } = input;
  const selectedItems = selectPendingReturnRequestItems(group.items, selections);
  if (selectedItems.length === 0) {
    throw new Error("処理するタンクを選択してください");
  }

  const baseContext = buildReturnConfirmationContext(group, actor);
  const confirmations = await resolveReturnConfirmations(group, selectedItems, selections);

  // スタッフ確定時点で pending_return を実際の tanks/logs 更新に反映する。
  await applyBulkTankOperations(
    buildReturnConfirmationOperations(confirmations, baseContext),
    (writer) => completePendingReturnRequests(writer, confirmations, actor),
  );

  return { processedCount: selectedItems.length };
}

function selectPendingReturnRequestItems(
  items: ReturnTagProcessingItem[],
  selections: ReturnTagProcessingSelections,
): ReturnTagProcessingItem[] {
  return items.filter((item) => selections[item.id]?.selected);
}

function buildReturnConfirmationContext(
  group: ReturnTagProcessingGroup,
  actor: OperationActor,
): OperationContext {
  return {
    actor,
    customer: {
      customerId: group.customerId,
      customerName: group.customerName,
    },
    source: "return_tag_processing",
    workflow: "return",
  };
}

function resolveReturnConfirmations(
  group: ReturnTagProcessingGroup,
  selectedItems: ReturnTagProcessingItem[],
  selections: ReturnTagProcessingSelections,
): Promise<ReturnConfirmation[]> {
  return Promise.all(
    selectedItems.map((item) => resolveReturnConfirmation(group, item, selections)),
  );
}

async function resolveReturnConfirmation(
  group: ReturnTagProcessingGroup,
  item: ReturnTagProcessingItem,
  selections: ReturnTagProcessingSelections,
): Promise<ReturnConfirmation> {
  const tankIdResult = tryParseTankId(item.tankId);
  if (!tankIdResult.ok) {
    throw new Error(`[${item.tankId}] ${tankIdResult.reason}`);
  }

  const tankId = tankIdResult.canonicalTankId;
  const selectedCondition = selections[item.id]?.condition ?? item.condition;
  const tag = conditionToReturnTag(selectedCondition);
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
}

function buildReturnConfirmationOperations(
  confirmations: ReturnConfirmation[],
  baseContext: OperationContext,
): TankOperationInput[] {
  return confirmations.map(({ item, tankId, condition, note, currentStatus, transitionAction, location }) => ({
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
  }));
}

function completePendingReturnRequests(
  writer: TankOperationWriter,
  confirmations: ReturnConfirmation[],
  actor: OperationActor,
): void {
  confirmations.forEach(({ item, condition }) => {
    writer.update(doc(db, "transactions", item.id), {
      status: "completed",
      finalCondition: condition,
      fulfilledAt: serverTimestamp(),
      fulfilledBy: actor.staffName,
      fulfilledByStaffId: actor.staffId,
      fulfilledByStaffName: actor.staffName,
      ...(actor.staffEmail ? { fulfilledByStaffEmail: actor.staffEmail } : {}),
    });
  });
}
