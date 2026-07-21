import type { OperationActor } from "@/lib/operation-context";
import { applyBulkTankOperations } from "@/lib/tank-operation";
import { ACTION } from "@/lib/tank-rules";

export type RepairTargetInput = {
  tankId: string;
  currentStatus: string;
};

export type SubmitRepairCompletionInput = {
  tanks: readonly RepairTargetInput[];
  actor: OperationActor;
};

export async function submitRepairCompletion(
  input: SubmitRepairCompletionInput,
): Promise<void> {
  const { tanks, actor } = input;
  const context = { actor };

  await applyBulkTankOperations(
    tanks.map(({ tankId, currentStatus }) => ({
      tankId,
      transitionAction: ACTION.REPAIRED,
      currentStatus,
      context,
      location: "倉庫",
    })),
  );
}
