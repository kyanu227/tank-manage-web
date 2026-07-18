import type { FirestoreWrite } from "./firestore-rest-types";
import { canonicalSha256, sha256Hex } from "./canonical-firestore-value";
import {
  PRODUCTION_CUTOVER_DATA_PRINCIPAL,
  PRODUCTION_CUTOVER_DATABASE_ID,
  PRODUCTION_CUTOVER_DATABASE_UID,
  PRODUCTION_CUTOVER_OPERATOR_PRINCIPAL,
  PRODUCTION_RESET_CONFIRMATION,
  PRODUCTION_RESTORE_CONFIRMATION,
  assertProductionExecutionIntent,
  createProductionExecutionIntent,
  type ProductionCutoverOperation,
  type ProductionExecutionIntent,
} from "./production-execution-contract";
import { CUTOVER_PROJECT_ID } from "./infra-contract";
import {
  authenticatedTransitionResetPlanContext,
  type TransitionResetPlan,
} from "./transition-reset-service";
import {
  authenticatedTransitionRestorePlanContext,
  type TransitionRestorePlan,
} from "./transition-snapshot-service";

// 後続の再close PRでは5境界を個別にfalseへ戻す。
const RESET_CLI_PRODUCTION_EXECUTE_ENABLED = true as const;
const RESTORE_CLI_PRODUCTION_EXECUTE_ENABLED = true as const;
const RESET_SERVICE_PRODUCTION_EXECUTE_ENABLED = true as const;
const RESTORE_SERVICE_PRODUCTION_EXECUTE_ENABLED = true as const;
const FIRESTORE_REST_PRODUCTION_COMMIT_ENABLED = true as const;

export type ProductionExecuteGatePosture =
  | "closed"
  | "armed_for_fixed_transition_v1"
  | "unsafe";

class ProductionCutoverExecutionDisabledError extends Error {
  readonly code = "PRODUCTION_CUTOVER_EXECUTE_DISABLED";
}

const commitAuthorizationBrand = Symbol("production-cutover-commit-authorization");
const issuedCommitAuthorizations = new WeakSet<object>();
const consumedCommitAuthorizations = new WeakSet<object>();

export type ProductionCommitAuthorization = Readonly<{
  [commitAuthorizationBrand]: true;
  operation: ProductionCutoverOperation;
  projectId: typeof CUTOVER_PROJECT_ID;
  databaseId: typeof PRODUCTION_CUTOVER_DATABASE_ID;
  databaseUid: typeof PRODUCTION_CUTOVER_DATABASE_UID;
  dataPrincipal: typeof PRODUCTION_CUTOVER_DATA_PRINCIPAL;
  commitBodySha256: string;
  writeCount: number;
}>;

type ProductionServiceExecutionContext = {
  projectId: string;
  databaseId: string;
  databaseUid: string | undefined;
  dataPrincipal: string | undefined;
  operatorPrincipal: string;
  mainCommit: string;
};

export function assertResetCliExecutionAllowed(input: {
  execute: boolean;
  emulatorHost?: string;
  intent?: ProductionExecutionIntent;
}): void {
  assertCliExecutionAllowed({
    ...input,
    operation: "reset",
    enabled: RESET_CLI_PRODUCTION_EXECUTE_ENABLED,
  });
}

export function assertRestoreCliExecutionAllowed(input: {
  execute: boolean;
  emulatorHost?: string;
  intent?: ProductionExecutionIntent;
}): void {
  assertCliExecutionAllowed({
    ...input,
    operation: "restore",
    enabled: RESTORE_CLI_PRODUCTION_EXECUTE_ENABLED,
  });
}

export function authorizeResetServiceExecution(input: {
  emulatorHost?: string;
  intent?: ProductionExecutionIntent;
  plan: TransitionResetPlan;
}): ProductionCommitAuthorization | undefined {
  if (input.emulatorHost) return undefined;
  return authorizeServiceExecution({
    intent: input.intent,
    context: authenticatedTransitionResetPlanContext(input.plan),
    operation: "reset",
    enabled: RESET_SERVICE_PRODUCTION_EXECUTE_ENABLED,
    summary: input.plan.summary,
    writes: input.plan.writes,
  });
}

export function authorizeRestoreServiceExecution(input: {
  emulatorHost?: string;
  intent?: ProductionExecutionIntent;
  plan: TransitionRestorePlan;
}): ProductionCommitAuthorization | undefined {
  if (input.emulatorHost) return undefined;
  return authorizeServiceExecution({
    intent: input.intent,
    context: authenticatedTransitionRestorePlanContext(input.plan),
    operation: "restore",
    enabled: RESTORE_SERVICE_PRODUCTION_EXECUTE_ENABLED,
    summary: input.plan.summary,
    writes: input.plan.writes,
  });
}

export function assertFirestoreCommitAllowed(input: {
  emulatorHost?: string;
  authorization?: unknown;
  operation: ProductionCutoverOperation;
  projectId: string;
  databaseId: string;
  databaseUid: string | undefined;
  dataPrincipal: string | undefined;
  serializedRequestBody: string;
  writeCount: number;
}): void {
  if (input.emulatorHost) return;
  if (!FIRESTORE_REST_PRODUCTION_COMMIT_ENABLED) {
    throw new ProductionCutoverExecutionDisabledError(
      "cutover用Firestore REST clientの本番commitは無効です",
    );
  }
  assertAndConsumeProductionCommitAuthorization({
    authorization: input.authorization,
    operation: input.operation,
    projectId: input.projectId,
    databaseId: input.databaseId,
    databaseUid: input.databaseUid,
    dataPrincipal: input.dataPrincipal,
    serializedRequestBody: input.serializedRequestBody,
    writeCount: input.writeCount,
  });
}

/** readinessは閉鎖または固定one-time契約への完全armedだけを受理する。 */
export function probeProductionExecuteGatePosture(): ProductionExecuteGatePosture {
  const states = [
    RESET_CLI_PRODUCTION_EXECUTE_ENABLED,
    RESTORE_CLI_PRODUCTION_EXECUTE_ENABLED,
    RESET_SERVICE_PRODUCTION_EXECUTE_ENABLED,
    RESTORE_SERVICE_PRODUCTION_EXECUTE_ENABLED,
    FIRESTORE_REST_PRODUCTION_COMMIT_ENABLED,
  ];
  if (states.every((state) => !state)) return "closed";
  if (!states.every(Boolean)) return "unsafe";

  try {
    const resetIntent = syntheticIntent("reset");
    const restoreIntent = syntheticIntent("restore");
    assertResetCliExecutionAllowed({ execute: true, intent: resetIntent });
    assertRestoreCliExecutionAllowed({ execute: true, intent: restoreIntent });
    let crossOperationRejected = false;
    try {
      assertResetCliExecutionAllowed({ execute: true, intent: restoreIntent });
    } catch {
      crossOperationRejected = true;
    }
    return crossOperationRejected ? "armed_for_fixed_transition_v1" : "unsafe";
  } catch {
    return "unsafe";
  }
}

function assertCliExecutionAllowed(input: {
  execute: boolean;
  emulatorHost?: string;
  intent?: ProductionExecutionIntent;
  operation: ProductionCutoverOperation;
  enabled: boolean;
}): void {
  if (!input.execute || input.emulatorHost) return;
  if (!input.enabled) {
    throw new ProductionCutoverExecutionDisabledError(
      `本番${input.operation} executeは無効です`,
    );
  }
  assertProductionExecutionIntent(input.intent, input.operation);
}

function authorizeServiceExecution(input: {
  intent?: ProductionExecutionIntent;
  context: ProductionServiceExecutionContext;
  operation: ProductionCutoverOperation;
  enabled: boolean;
  summary: {
    snapshotId: string;
    snapshotPayloadSha256: string;
    sourceCensusSha256: string;
    resetPlanSha256: string;
  };
  writes: readonly FirestoreWrite[];
}): ProductionCommitAuthorization | undefined {
  if (!input.enabled) {
    throw new ProductionCutoverExecutionDisabledError(
      `本番${input.operation} executeは無効です`,
    );
  }
  assertProductionExecutionIntent(input.intent, input.operation);
  const comparisons: Array<[unknown, unknown, string]> = [
    [input.context.projectId, input.intent.projectId, "project"],
    [input.context.databaseId, input.intent.databaseId, "database"],
    [input.context.databaseUid, input.intent.databaseUid, "database UID"],
    [input.context.dataPrincipal, input.intent.dataPrincipal, "data principal"],
    [input.context.operatorPrincipal, input.intent.operatorPrincipal, "operator principal"],
    [input.context.mainCommit, input.intent.mainCommit, "main commit"],
    [input.summary.snapshotId, input.intent.snapshotId, "snapshot ID"],
    [input.summary.snapshotPayloadSha256, input.intent.snapshotPayloadSha256,
      "snapshot payload SHA-256"],
    [input.summary.sourceCensusSha256, input.intent.sourceCensusSha256,
      "source census SHA-256"],
    [input.summary.resetPlanSha256, input.intent.resetPlanSha256, "reset plan SHA-256"],
  ];
  const mismatch = comparisons.find(([actualValue, expectedValue]) => actualValue !== expectedValue);
  if (mismatch) {
    throw new Error(`production ${input.operation}の${mismatch[2]}が承認済み契約と一致しません`);
  }
  if (input.writes.length === 0) throw new Error("production cutover write列が空です");
  const authorization = Object.freeze({
    [commitAuthorizationBrand]: true as const,
    operation: input.operation,
    projectId: CUTOVER_PROJECT_ID,
    databaseId: PRODUCTION_CUTOVER_DATABASE_ID,
    databaseUid: PRODUCTION_CUTOVER_DATABASE_UID,
    dataPrincipal: PRODUCTION_CUTOVER_DATA_PRINCIPAL,
    commitBodySha256: canonicalSha256({ writes: input.writes }),
    writeCount: input.writes.length,
  });
  issuedCommitAuthorizations.add(authorization);
  return authorization;
}

function syntheticIntent(operation: ProductionCutoverOperation): ProductionExecutionIntent {
  return createProductionExecutionIntent({
    operation,
    confirmation: operation === "reset"
      ? PRODUCTION_RESET_CONFIRMATION
      : PRODUCTION_RESTORE_CONFIRMATION,
    projectId: CUTOVER_PROJECT_ID,
    databaseId: PRODUCTION_CUTOVER_DATABASE_ID,
    databaseUid: PRODUCTION_CUTOVER_DATABASE_UID,
    dataPrincipal: PRODUCTION_CUTOVER_DATA_PRINCIPAL,
    operatorPrincipal: PRODUCTION_CUTOVER_OPERATOR_PRINCIPAL,
    mainCommit: "a".repeat(40),
    snapshotId: "readiness-probe",
    snapshotPayloadSha256: "b".repeat(64),
    sourceCensusSha256: "c".repeat(64),
    resetPlanSha256: "d".repeat(64),
  });
}

function assertAndConsumeProductionCommitAuthorization(input: {
  authorization: unknown;
  operation: ProductionCutoverOperation;
  projectId: string;
  databaseId: string;
  databaseUid: string | undefined;
  dataPrincipal: string | undefined;
  serializedRequestBody: string;
  writeCount: number;
}): void {
  const authorization = input.authorization as ProductionCommitAuthorization | undefined;
  if (
    !authorization
    || authorization[commitAuthorizationBrand] !== true
    || !Object.isFrozen(authorization)
    || !issuedCommitAuthorizations.has(authorization)
  ) {
    throw new Error("production Firestore commit authorizationがありません");
  }
  if (consumedCommitAuthorizations.has(authorization)) {
    throw new Error("production Firestore commit authorizationは既に使用済みです");
  }
  const commitBodySha256 = sha256Hex(input.serializedRequestBody);
  if (
    input.operation !== authorization.operation
    || input.projectId !== authorization.projectId
    || input.databaseId !== authorization.databaseId
    || input.databaseUid !== authorization.databaseUid
    || input.dataPrincipal !== authorization.dataPrincipal
    || input.writeCount !== authorization.writeCount
    || commitBodySha256 !== authorization.commitBodySha256
  ) {
    throw new Error("production Firestore commitが承認済みoperation/write契約と一致しません");
  }
  // request開始前にconsumeし、同一process内での自動・手動再送を拒否する。
  consumedCommitAuthorizations.add(authorization);
}
