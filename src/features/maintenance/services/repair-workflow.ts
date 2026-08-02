import type { OperationActor } from "@/lib/operation-context";
import {
  applyBulkTankOperations,
  type TankRecoveryConfirmationResolver,
} from "@/lib/tank-operation";
import { ACTION } from "@/lib/tank-rules";

export type RepairTargetInput = {
  tankId: string;
  currentStatus: string;
};

export type SubmitRepairCompletionInput = {
  tanks: readonly RepairTargetInput[];
  actor: OperationActor;
  recoveryConfirmationResolver?: TankRecoveryConfirmationResolver;
};

export async function submitRepairCompletion(
  input: SubmitRepairCompletionInput,
): Promise<void> {
  const { tanks, actor, recoveryConfirmationResolver } = input;
  const context = {
    actor,
    source: "maintenance" as const,
    workflow: "repair" as const,
  };

  const operations = tanks.map(({ tankId, currentStatus }) => ({
    tankId,
    transitionAction: ACTION.REPAIRED,
    currentStatus,
    context,
    location: "倉庫",
  }));
  await applyBulkTankOperations(operations, undefined, {
    recoveryConfirmationResolver,
  });
}
