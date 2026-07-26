import type { OperationActor } from "@/lib/operation-context";
import { applyTankOperation } from "@/lib/tank-operation";
import { ACTION } from "@/lib/tank-rules";

export type SubmitInHouseUseReportInput = {
  tankId: string;
  currentStatus: string;
  actor: OperationActor;
};

export async function submitInHouseUseReport(
  input: SubmitInHouseUseReportInput,
): Promise<void> {
  const { tankId, currentStatus, actor } = input;
  const context = {
    actor,
    source: "manual" as const,
    workflow: "tank_operation" as const,
  };

  await applyTankOperation({
    tankId,
    transitionAction: ACTION.IN_HOUSE_USE_RETRO,
    currentStatus,
    context,
    location: "自社",
    logNote: "事後報告",
  });
}
