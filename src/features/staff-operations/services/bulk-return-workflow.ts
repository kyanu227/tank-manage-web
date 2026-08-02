import { updateTankReturnTagMarker } from "@/lib/firebase/tank-tag-service";
import {
  coerceTankStatusCode,
  type TankStatusCode,
} from "@/lib/tank-action-status-codes";
import type { OperationActor } from "@/lib/operation-context";
import {
  applyBulkTankOperations,
  StaleTankCycleError,
  type ExpectedTankCycle,
  type StaleTankCycleIssue,
  type TankRecoveryConfirmationResolver,
} from "@/lib/tank-operation";
import {
  RETURN_TAG,
  resolveReturnActionCode,
  type ReturnTag,
} from "@/lib/tank-rules";
import {
  getBulkReturnObservedCycleMarkers,
  type BulkReturnRawCycleMarkers,
} from "../bulk-return-cycle-readiness";

export type BulkReturnTargetInput = {
  id: string;
  status: string;
  customerId?: string | null;
  latestLogId?: string | null;
  rawCycleMarkers?: BulkReturnRawCycleMarkers;
  location?: string;
  tag: ReturnTag;
};

export type SubmitBulkReturnGroupInput = {
  tanks: readonly BulkReturnTargetInput[];
  fallbackLocation: string;
  actor: OperationActor;
  recoveryConfirmationResolver?: TankRecoveryConfirmationResolver;
};

/** 貸出先別一括返却のpayloadを入力順で構築し、1回のbulk operationで送る。 */
export async function submitBulkReturnGroup(
  input: SubmitBulkReturnGroupInput,
): Promise<void> {
  const {
    tanks,
    fallbackLocation,
    actor,
    recoveryConfirmationResolver,
  } = input;
  const validatedTargets = requireBulkReturnExpectedCycles(tanks);
  const context = {
    actor,
    source: "bulk_return" as const,
    workflow: "tank_operation" as const,
  };

  const operations = validatedTargets.map(({ tank, expectedCycle }) => {
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
      expectedCycle,
    };
  });
  await applyBulkTankOperations(operations, undefined, {
    recoveryConfirmationResolver,
  });
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

function requireBulkReturnExpectedCycles(
  tanks: readonly BulkReturnTargetInput[],
): Array<{
  tank: BulkReturnTargetInput;
  expectedCycle: ExpectedTankCycle;
}> {
  const issues: StaleTankCycleIssue[] = [];
  const validated: Array<{
    tank: BulkReturnTargetInput;
    expectedCycle: ExpectedTankCycle;
  }> = [];

  tanks.forEach((tank) => {
    const { customerId, latestLogId } = getBulkReturnObservedCycleMarkers(tank);
    const customerIdValid = isNonEmptyString(customerId);
    const latestLogIdValid = isNonEmptyString(latestLogId);
    if (!customerIdValid) {
      issues.push({
        tankId: tank.id,
        field: "customerId",
        reason: "missing_expected",
      });
    }
    if (!latestLogIdValid) {
      issues.push({
        tankId: tank.id,
        field: "latestLogId",
        reason: "missing_expected",
      });
    }
    if (customerIdValid && latestLogIdValid) {
      validated.push({
        tank,
        expectedCycle: {
          customerId,
          latestLogId,
        },
      });
    }
  });

  if (issues.length > 0) {
    throw new StaleTankCycleError(issues);
  }
  return validated;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}
