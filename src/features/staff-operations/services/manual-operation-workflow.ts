import { requireStaffIdentity } from "@/hooks/useStaffSession";
import { coerceTankStatusCode } from "@/lib/tank-action-status-codes";
import type { CustomerSnapshot, OperationContext } from "@/lib/operation-context";
import {
  returnTagToReturnCondition,
  returnTagToStoredLogNote,
} from "@/lib/return-tag-rules";
import {
  applyBulkTankOperations,
  type TankRecoveryConfirmationResolver,
} from "@/lib/tank-operation";
import {
  RETURN_TAG,
  resolveReturnActionCode,
  type ReturnTag,
} from "@/lib/tank-rules";
import type { OpMode, TagType, TankMap } from "../types";

export type ManualOperationQueueInput = {
  tankId: string;
  status?: string;
  tag: TagType;
};

export type SubmitManualTankOperationInput = {
  mode: OpMode;
  items: readonly ManualOperationQueueInput[];
  customer: CustomerSnapshot | null;
  tanks: TankMap;
  recoveryConfirmationResolver?: TankRecoveryConfirmationResolver;
};

export async function submitManualTankOperation(
  input: SubmitManualTankOperationInput,
): Promise<void> {
  const {
    mode,
    items,
    customer,
    tanks,
    recoveryConfirmationResolver,
  } = input;
  const actor = requireStaffIdentity();
  const baseContext: OperationContext = {
    actor,
    source: "manual",
    workflow: "tank_operation",
    ...(mode === "lend" && customer
      ? { customer }
      : {}),
  };

  const operations = items.map((item) => {
    const tag = (item.tag || RETURN_TAG.NORMAL) as ReturnTag;
    const statusCode = coerceTankStatusCode(item.status ?? "");
    if (!statusCode) {
      throw new Error(`[${item.tankId}] タンク状態が不正です`);
    }
    const resolvedAction = mode === "return"
      ? resolveReturnActionCode(tag, statusCode)
      : mode;

    const currentTank = tanks[item.tankId];
    let finalLocation = "倉庫";
    let finalTankNote = "";
    let finalLogNote = "";

    if (mode === "lend") {
      finalLocation = customer?.customerName ?? "";
    } else if (mode === "return") {
      if (tag === RETURN_TAG.KEEP) {
        finalLocation = currentTank?.location || "不明";
        finalLogNote = "持ち越し";
      } else {
        const storedLogNote = returnTagToStoredLogNote(tag);
        finalTankNote = storedLogNote;
        finalLogNote = storedLogNote;
      }
    }

    return {
      tankId: item.tankId,
      transitionAction: resolvedAction,
      currentStatus: item.status || "",
      context: mode === "return"
        ? {
            ...baseContext,
            returnCondition: returnTagToReturnCondition(tag),
          }
        : baseContext,
      location: finalLocation,
      tankNote: finalTankNote,
      logNote: finalLogNote,
    };
  });
  await applyBulkTankOperations(operations, undefined, {
    recoveryConfirmationResolver,
  });
}
