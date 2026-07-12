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
  type TankOperationResult,
  type TankOperationWriter,
} from "@/lib/tank-operation";
import { coerceTankStatusCode, type TankActionCode, type TankStatusCode } from "@/lib/tank-action-status-codes";
import {
  RETURN_TAG,
  resolveReturnActionCode,
} from "@/lib/tank-rules";

type PendingReturnRequestItem = {
  id: string;
  tankId: string;
  condition: ReturnCondition;
};

type PendingReturnRequestGroup = {
  customerId: string;
  customerName: string;
  items: PendingReturnRequestItem[];
};

type ReturnConfirmationSelections = Record<
  string,
  { selected: boolean; condition: ReturnCondition } | undefined
>;

type ReturnConfirmation = {
  item: PendingReturnRequestItem;
  tankId: string;
  condition: ReturnCondition;
  note: string;
  currentStatus: string;
  transitionAction: TankActionCode;
  location: string;
};

type ReturnTransactionCompletionPatch = {
  status: "completed";
  finalCondition: ReturnCondition;
  fulfilledLogId: string;
  fulfilledAt: ReturnType<typeof serverTimestamp>;
  fulfilledBy: string;
  fulfilledByStaffId: string;
  fulfilledByStaffName: string;
  fulfilledByStaffEmail?: string;
};

export type ConfirmPendingReturnRequestsInput = {
  group: PendingReturnRequestGroup;
  selections: ReturnConfirmationSelections;
  actor: OperationActor;
};

export type ConfirmPendingReturnRequestsResult = {
  processedCount: number;
};

export async function confirmPendingReturnRequests(
  input: ConfirmPendingReturnRequestsInput,
): Promise<ConfirmPendingReturnRequestsResult> {
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
    (writer, results) => completePendingReturnRequests(
      writer,
      confirmations,
      results,
      actor,
    ),
  );

  return { processedCount: selectedItems.length };
}

function selectPendingReturnRequestItems(
  items: PendingReturnRequestItem[],
  selections: ReturnConfirmationSelections,
): PendingReturnRequestItem[] {
  return items.filter((item) => selections[item.id]?.selected);
}

function buildReturnConfirmationContext(
  group: PendingReturnRequestGroup,
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
  group: PendingReturnRequestGroup,
  selectedItems: PendingReturnRequestItem[],
  selections: ReturnConfirmationSelections,
): Promise<ReturnConfirmation[]> {
  return Promise.all(
    selectedItems.map((item) => resolveReturnConfirmation(group, item, selections)),
  );
}

async function resolveReturnConfirmation(
  group: PendingReturnRequestGroup,
  item: PendingReturnRequestItem,
  selections: ReturnConfirmationSelections,
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
  const currentStatusCode = requireReturnTankStatusCode(currentStatus, tankId);
  const isKeep = tag === RETURN_TAG.KEEP;
  const transitionAction: TankActionCode = isKeep
    ? "carry_over"
    : resolveReturnActionCode(tag, currentStatusCode);
  const location = isKeep
    ? tank.location || group.customerName
    : "倉庫";

  return { item, tankId, condition, note, currentStatus, transitionAction, location };
}

function requireReturnTankStatusCode(status: string, tankId: string): TankStatusCode {
  const code = coerceTankStatusCode(status);
  if (!code) {
    throw new Error(`[${tankId}] status が不正です`);
  }
  return code;
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
  results: readonly TankOperationResult[],
  actor: OperationActor,
): void {
  const resultByTankId = new Map(results.map((result) => [result.tankId, result]));
  confirmations.forEach(({ item, condition }) => {
    const result = resultByTankId.get(normalizeReturnTankId(item.tankId));
    if (!result) {
      throw new Error(`[${item.tankId}] 返却ログIDをtransactionに紐付けできません`);
    }
    writer.update(
      doc(db, "transactions", item.id),
      buildReturnTransactionCompletionPatch(condition, result.logRef.id, actor),
    );
  });
}

function buildReturnTransactionCompletionPatch(
  condition: ReturnCondition,
  fulfilledLogId: string,
  actor: OperationActor,
): ReturnTransactionCompletionPatch {
  return {
    status: "completed",
    finalCondition: condition,
    fulfilledLogId,
    fulfilledAt: serverTimestamp(),
    fulfilledBy: actor.staffName,
    fulfilledByStaffId: actor.staffId,
    fulfilledByStaffName: actor.staffName,
    ...(actor.staffEmail ? { fulfilledByStaffEmail: actor.staffEmail } : {}),
  };
}

function normalizeReturnTankId(tankId: string): string {
  const parsed = tryParseTankId(tankId);
  return parsed.ok ? parsed.canonicalTankId : tankId.trim().toUpperCase();
}
