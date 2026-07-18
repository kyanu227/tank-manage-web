import { CUTOVER_INFRA_CONTRACT, CUTOVER_PROJECT_ID } from "./infra-contract";

export const PRODUCTION_CUTOVER_DATABASE_ID = "(default)" as const;
export const PRODUCTION_CUTOVER_DATABASE_UID =
  "8dcf700f-01a3-4861-bee9-d901504f26b4" as const;
export const PRODUCTION_CUTOVER_DATA_PRINCIPAL =
  CUTOVER_INFRA_CONTRACT.serviceAccounts.data.email;
export const PRODUCTION_CUTOVER_OPERATOR_PRINCIPAL =
  "user:okmarineclub@gmail.com" as const;
export const PRODUCTION_RESET_CONFIRMATION =
  "EXECUTE_TRANSITION_CUTOVER_RESET_ONCE_20260718" as const;
export const PRODUCTION_RESTORE_CONFIRMATION =
  "EXECUTE_TRANSITION_CUTOVER_RESTORE_ONCE_20260718" as const;

export type ProductionCutoverOperation = "reset" | "restore";

export type TransitionExecutionIdentity = {
  operatorPrincipal: string;
  dataPrincipal: string;
};

const executionIntentBrand = Symbol("production-cutover-execution-intent");

export type ProductionExecutionIntent = Readonly<{
  [executionIntentBrand]: true;
  operation: ProductionCutoverOperation;
  projectId: typeof CUTOVER_PROJECT_ID;
  databaseId: typeof PRODUCTION_CUTOVER_DATABASE_ID;
  databaseUid: typeof PRODUCTION_CUTOVER_DATABASE_UID;
  dataPrincipal: typeof PRODUCTION_CUTOVER_DATA_PRINCIPAL;
  operatorPrincipal: typeof PRODUCTION_CUTOVER_OPERATOR_PRINCIPAL;
  mainCommit: string;
  snapshotId: string;
  snapshotPayloadSha256: string;
  sourceCensusSha256: string;
  resetPlanSha256: string;
}>;

export function createProductionExecutionIntent(input: {
  operation: ProductionCutoverOperation;
  confirmation: string;
  projectId: string;
  databaseId: string;
  databaseUid: string;
  dataPrincipal: string;
  operatorPrincipal: string;
  mainCommit: string;
  snapshotId: string;
  snapshotPayloadSha256: string;
  sourceCensusSha256: string;
  resetPlanSha256: string;
}): ProductionExecutionIntent {
  const expectedConfirmation = input.operation === "reset"
    ? PRODUCTION_RESET_CONFIRMATION
    : PRODUCTION_RESTORE_CONFIRMATION;
  if (input.confirmation !== expectedConfirmation) {
    throw new Error(`${input.operation}用のproduction confirmationが一致しません`);
  }
  if (input.projectId !== CUTOVER_PROJECT_ID) {
    throw new Error("production cutover projectが固定契約と一致しません");
  }
  if (input.databaseId !== PRODUCTION_CUTOVER_DATABASE_ID) {
    throw new Error("production cutover databaseが固定契約と一致しません");
  }
  if (input.databaseUid !== PRODUCTION_CUTOVER_DATABASE_UID) {
    throw new Error("production cutover database UIDが固定契約と一致しません");
  }
  if (input.dataPrincipal !== PRODUCTION_CUTOVER_DATA_PRINCIPAL) {
    throw new Error("production cutover data principalが固定契約と一致しません");
  }
  if (input.operatorPrincipal !== PRODUCTION_CUTOVER_OPERATOR_PRINCIPAL) {
    throw new Error("production cutover operator principalが固定契約と一致しません");
  }
  requireSha(input.mainCommit, 40, "main commit");
  requireSnapshotId(input.snapshotId);
  requireSha(input.snapshotPayloadSha256, 64, "snapshot payload SHA-256");
  requireSha(input.sourceCensusSha256, 64, "source census SHA-256");
  requireSha(input.resetPlanSha256, 64, "reset plan SHA-256");
  return Object.freeze({
    [executionIntentBrand]: true as const,
    operation: input.operation,
    projectId: CUTOVER_PROJECT_ID,
    databaseId: PRODUCTION_CUTOVER_DATABASE_ID,
    databaseUid: PRODUCTION_CUTOVER_DATABASE_UID,
    dataPrincipal: PRODUCTION_CUTOVER_DATA_PRINCIPAL,
    operatorPrincipal: PRODUCTION_CUTOVER_OPERATOR_PRINCIPAL,
    mainCommit: input.mainCommit,
    snapshotId: input.snapshotId,
    snapshotPayloadSha256: input.snapshotPayloadSha256,
    sourceCensusSha256: input.sourceCensusSha256,
    resetPlanSha256: input.resetPlanSha256,
  });
}

export function createProductionExecutionIntentFromCli(input: {
  operation: ProductionCutoverOperation;
  argv: readonly string[];
  projectId: string;
  databaseId: string;
  databaseUid: string;
  dataPrincipal: string;
  mainCommit: string;
}): ProductionExecutionIntent {
  return createProductionExecutionIntent({
    operation: input.operation,
    confirmation: requiredCliValue(input.argv, "--confirm"),
    projectId: input.projectId,
    databaseId: input.databaseId,
    databaseUid: input.databaseUid,
    dataPrincipal: input.dataPrincipal,
    operatorPrincipal: requiredCliValue(input.argv, "--operator-principal"),
    mainCommit: input.mainCommit,
    snapshotId: requiredCliValue(input.argv, "--expected-snapshot-id"),
    snapshotPayloadSha256: requiredCliValue(
      input.argv,
      "--expected-snapshot-payload-sha256",
    ),
    sourceCensusSha256: requiredCliValue(input.argv, "--expected-source-census-sha256"),
    resetPlanSha256: requiredCliValue(input.argv, "--expected-reset-plan-sha256"),
  });
}

export function assertProductionExecutionIntent(
  intent: ProductionExecutionIntent | undefined,
  operation: ProductionCutoverOperation,
): asserts intent is ProductionExecutionIntent {
  if (
    !intent
    || intent[executionIntentBrand] !== true
    || intent.operation !== operation
    || !Object.isFrozen(intent)
  ) {
    throw new Error(`${operation}用のproduction execution intentがありません`);
  }
}

export function productionExecutionIdentity(): TransitionExecutionIdentity {
  return {
    operatorPrincipal: PRODUCTION_CUTOVER_OPERATOR_PRINCIPAL,
    dataPrincipal: PRODUCTION_CUTOVER_DATA_PRINCIPAL,
  };
}

export function emulatorExecutionIdentity(): TransitionExecutionIdentity {
  return {
    operatorPrincipal: "user:emulator-cutover@example.invalid",
    dataPrincipal: "transition-cutover-data@demo.invalid",
  };
}

function requireSha(value: string, length: 40 | 64, label: string): void {
  if (!new RegExp(`^[0-9a-f]{${length}}$`, "u").test(value)) {
    throw new Error(`${label}が不正です`);
  }
}

function requireSnapshotId(value: string): void {
  if (!/^[A-Za-z0-9._-]{1,100}$/u.test(value)) {
    throw new Error("snapshot IDが不正です");
  }
}

function requiredCliValue(argv: readonly string[], name: string): string {
  const prefix = `${name}=`;
  const matches = argv.filter((argument) => argument.startsWith(prefix));
  if (matches.length !== 1) {
    throw new Error(`${name}=<value> を一度だけ指定してください`);
  }
  const value = matches[0].slice(prefix.length).trim();
  if (!value) throw new Error(`${name}=<value> は必須です`);
  return value;
}
