import type {
  CustomerSnapshot,
  OperationActor,
} from "@/lib/operation-context";
import {
  applyLogCorrection,
  voidLog,
  type StaffCorrectionRole,
} from "@/lib/tank-operation";

export type ResolveCorrectionActor = () => OperationActor;

export type DashboardLogTargetInput = {
  id: string;
  tankId: string;
};

export type CorrectDashboardLogTankIdInput = {
  targetLogId: string;
  tankId: string;
  reason: string;
  editedByRole: StaffCorrectionRole;
  resolveActor: ResolveCorrectionActor;
};

export type VoidDashboardLogInput = {
  logId: string;
  reason: string;
  voidedByRole: StaffCorrectionRole;
  resolveActor: ResolveCorrectionActor;
};

export type CorrectDashboardLogLocationsInput = {
  logs: readonly DashboardLogTargetInput[];
  location: string;
  customer: CustomerSnapshot | null;
  reason: string;
  editedByRole: StaffCorrectionRole;
  resolveActor: ResolveCorrectionActor;
};

export type VoidDashboardLogsInput = {
  logs: readonly DashboardLogTargetInput[];
  reason: string;
  voidedByRole: StaffCorrectionRole;
  resolveActor: ResolveCorrectionActor;
};

/** 単一ログのタンクID訂正を既存atomic coreへ委譲する。 */
export async function correctDashboardLogTankId(
  input: CorrectDashboardLogTankIdInput,
): Promise<{ logId: string }> {
  const {
    targetLogId,
    tankId,
    reason,
    editedByRole,
    resolveActor,
  } = input;

  return applyLogCorrection({
    targetLogId,
    mode: "replace",
    patch: {
      tankId,
    },
    reason,
    editor: resolveActor(),
    editedByRole,
  });
}

/** 単一ログの取消を既存atomic coreへ委譲する。 */
export async function voidDashboardLog(
  input: VoidDashboardLogInput,
): Promise<void> {
  const {
    logId,
    reason,
    voidedByRole,
    resolveActor,
  } = input;

  await voidLog({
    logId,
    voider: resolveActor(),
    voidedByRole,
    reason,
  });
}

/** 選択ログを入力順で逐次訂正し、item単位の失敗だけを返す。 */
export async function correctDashboardLogLocations(
  input: CorrectDashboardLogLocationsInput,
): Promise<string[]> {
  const {
    logs,
    location,
    customer,
    reason,
    editedByRole,
    resolveActor,
  } = input;
  const failures: string[] = [];

  for (const log of logs) {
    try {
      await applyLogCorrection({
        targetLogId: log.id,
        mode: "replace",
        patch: {
          location,
          customer,
        },
        reason,
        editor: resolveActor(),
        editedByRole,
      });
    } catch (error: unknown) {
      failures.push(`${log.tankId}: ${errorMessage(error)}`);
    }
  }

  return failures;
}

/** 選択ログを入力順で逐次取消し、item単位の失敗だけを返す。 */
export async function voidDashboardLogs(
  input: VoidDashboardLogsInput,
): Promise<string[]> {
  const {
    logs,
    reason,
    voidedByRole,
    resolveActor,
  } = input;
  const failures: string[] = [];

  for (const log of logs) {
    try {
      await voidLog({
        logId: log.id,
        voider: resolveActor(),
        voidedByRole,
        reason,
      });
    } catch (error: unknown) {
      failures.push(`${log.tankId}: ${errorMessage(error)}`);
    }
  }

  return failures;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
