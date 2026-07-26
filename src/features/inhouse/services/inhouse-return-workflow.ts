import type { OperationActor } from "@/lib/operation-context";
import { applyBulkTankOperations } from "@/lib/tank-operation";
import { updateTankReturnTagMarker } from "@/lib/firebase/tank-tag-service";
import {
  RETURN_TAG,
  resolveReturnActionCode,
  type ReturnTag,
} from "@/lib/tank-rules";

export type InHouseReturnTargetInput = {
  tankId: string;
  tag: ReturnTag;
};

export type SubmitInHouseBulkReturnInput = {
  tanks: readonly InHouseReturnTargetInput[];
  actor: OperationActor;
};

/** 自社利用中タンクの一括返却。tag別にactionを解決してpayloadを組み、1回のbulk operationで送る。 */
export async function submitInHouseBulkReturn(
  input: SubmitInHouseBulkReturnInput,
): Promise<void> {
  const { tanks, actor } = input;
  const context = {
    actor,
    source: "manual" as const,
    workflow: "tank_operation" as const,
  };

  await applyBulkTankOperations(
    tanks.map((tank) => {
      const tag = (tank.tag || RETURN_TAG.NORMAL) as ReturnTag;
      return {
        tankId: tank.tankId,
        transitionAction: resolveReturnActionCode(tag, "in_house"),
        currentStatus: "in_house",
        context,
        location: "倉庫",
      };
    }),
  );
}

/** 返却タグ marker の単独write。状態遷移・logsは扱わない。 */
export async function updateInHouseReturnTagMarker(
  tankId: string,
  tag: ReturnTag,
): Promise<void> {
  await updateTankReturnTagMarker(tankId, tag);
}
