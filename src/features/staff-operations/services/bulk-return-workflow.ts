import { updateTankReturnTagMarker } from "@/lib/firebase/tank-tag-service";
import {
  coerceTankStatusCode,
  type TankStatusCode,
} from "@/lib/tank-action-status-codes";
import type { OperationActor } from "@/lib/operation-context";
import { applyBulkTankOperations } from "@/lib/tank-operation";
import {
  RETURN_TAG,
  resolveReturnActionCode,
  type ReturnTag,
} from "@/lib/tank-rules";

export type BulkReturnTargetInput = {
  id: string;
  status: string;
  location?: string;
  tag: ReturnTag;
};

export type SubmitBulkReturnGroupInput = {
  tanks: readonly BulkReturnTargetInput[];
  fallbackLocation: string;
  actor: OperationActor;
};

/** 貸出先別一括返却のpayloadを入力順で構築し、1回のbulk operationで送る。 */
export async function submitBulkReturnGroup(
  input: SubmitBulkReturnGroupInput,
): Promise<void> {
  const { tanks, fallbackLocation, actor } = input;
  const context = {
    actor,
    source: "bulk_return" as const,
    workflow: "tank_operation" as const,
  };

  await applyBulkTankOperations(
    tanks.map((tank) => {
      const tag = (tank.tag || RETURN_TAG.NORMAL) as ReturnTag;
      const isKeep = tag === RETURN_TAG.KEEP;
      return {
        tankId: tank.id,
        transitionAction: resolveReturnActionCode(
          tag,
          requireBulkTankStatusCode(tank.status, tank.id),
        ),
        currentStatus: tank.status,
        context,
        location: isKeep
          ? tank.location || fallbackLocation || "不明"
          : "倉庫",
        tankNote: "",
        logNote: isKeep ? "持ち越し" : "",
      };
    }),
  );
}

/** 返却タグmarkerの単独writeを既存ownerへ委譲する。 */
export async function updateBulkReturnTagMarker(
  tankId: string,
  tag: ReturnTag,
): Promise<void> {
  await updateTankReturnTagMarker(tankId, tag);
}

function requireBulkTankStatusCode(
  status: string,
  tankId: string,
): TankStatusCode {
  const code = coerceTankStatusCode(status);
  if (!code) {
    throw new Error(`[${tankId}] status が不正です`);
  }
  return code;
}
