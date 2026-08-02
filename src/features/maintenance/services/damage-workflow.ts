import type { OperationActor } from "@/lib/operation-context";
import {
  applyBulkTankOperations,
  type TankRecoveryConfirmationResolver,
} from "@/lib/tank-operation";
import { ACTION } from "@/lib/tank-rules";

export type SubmitDamageReportInput = {
  tankIds: readonly string[];
  note: string;
  actor: OperationActor;
  recoveryConfirmationResolver?: TankRecoveryConfirmationResolver;
};

export async function submitDamageReport(
  input: SubmitDamageReportInput,
): Promise<void> {
  const { tankIds, note, actor, recoveryConfirmationResolver } = input;
  const context = {
    actor,
    source: "maintenance" as const,
    workflow: "damage" as const,
  };

  const operations = tankIds.map((tankId) => ({
    tankId,
    transitionAction: ACTION.DAMAGE_REPORT,
    context,
    location: "倉庫",
    logNote: note,
  }));
  await applyBulkTankOperations(operations, undefined, {
    recoveryConfirmationResolver,
  });
}
