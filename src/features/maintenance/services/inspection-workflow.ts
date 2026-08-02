import type { OperationActor } from "@/lib/operation-context";
import { calculateInspectionSchedule } from "@/lib/inspection-schedule";
import { applyBulkTankOperations } from "@/lib/tank-operation";
import { ACTION } from "@/lib/tank-rules";

export type InspectionTargetInput = {
  tankId: string;
  currentStatus: string;
};

export type SubmitInspectionCompletionInput = {
  tanks: readonly InspectionTargetInput[];
  validityYears: number;
  nextInspectionDateBase: Date;
  inspectionDate: Date;
  actor: OperationActor;
};

export async function submitInspectionCompletion(
  input: SubmitInspectionCompletionInput,
): Promise<void> {
  const {
    tanks,
    validityYears,
    nextInspectionDateBase,
    inspectionDate,
    actor,
  } = input;
  const context = {
    actor,
    source: "maintenance" as const,
    workflow: "inspection" as const,
  };
  const schedule = calculateInspectionSchedule({
    validityYears,
    nextInspectionDateBase,
    inspectionDate,
  });

  await applyBulkTankOperations(
    tanks.map(({ tankId, currentStatus }) => ({
      tankId,
      transitionAction: ACTION.INSPECTION,
      currentStatus,
      context,
      location: "倉庫",
      tankExtra: {
        maintenanceDate: schedule.maintenanceDate,
        nextMaintenanceDate: schedule.nextMaintenanceDate,
      },
    })),
  );
}
