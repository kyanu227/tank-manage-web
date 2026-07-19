import type { OperationActor } from "@/lib/operation-context";
import { applyBulkTankOperations } from "@/lib/tank-operation";
import { ACTION } from "@/lib/tank-rules";

export type SubmitDamageReportInput = {
  tankIds: readonly string[];
  note: string;
  actor: OperationActor;
};

export async function submitDamageReport(
  input: SubmitDamageReportInput,
): Promise<void> {
  const { tankIds, note, actor } = input;
  const context = { actor };

  await applyBulkTankOperations(
    tankIds.map((tankId) => ({
      tankId,
      transitionAction: ACTION.DAMAGE_REPORT,
      context,
      location: "倉庫",
      logNote: note,
    })),
  );
}
