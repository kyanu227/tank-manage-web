import { describe, expect, it } from "vitest";
import { serializeFirestoreRestBody } from "./firestore-rest-client";
import type { FirestoreWrite } from "./firestore-rest-types";
import {
  assertFirestoreCommitAllowed,
  assertResetCliExecutionAllowed,
  assertRestoreCliExecutionAllowed,
  authorizeResetServiceExecution,
  probeProductionExecuteGatePosture,
} from "./production-execute-gates";
import {
  PRODUCTION_CUTOVER_DATA_PRINCIPAL,
  PRODUCTION_CUTOVER_DATABASE_ID,
  PRODUCTION_CUTOVER_DATABASE_UID,
  PRODUCTION_CUTOVER_OPERATOR_PRINCIPAL,
  PRODUCTION_RESET_CONFIRMATION,
  PRODUCTION_RESTORE_CONFIRMATION,
  createProductionExecutionIntent,
  createProductionExecutionIntentFromCli,
  type ProductionCutoverOperation,
  type ProductionExecutionIntent,
} from "./production-execution-contract";
import { CUTOVER_PROJECT_ID } from "./infra-contract";
import type { TransitionResetPlan } from "./transition-reset-service";

const WRITES: FirestoreWrite[] = [{
  delete: `projects/${CUTOVER_PROJECT_ID}/databases/${PRODUCTION_CUTOVER_DATABASE_ID}`
    + "/documents/tanks/T-001",
  currentDocument: { updateTime: "2026-07-18T00:00:00Z" },
}];

describe("production cutover execute gates", () => {
  it("production target・principal・operation tokenを確定値へ固定する", () => {
    expect(CUTOVER_PROJECT_ID).toBe("okmarine-tankrental");
    expect(PRODUCTION_CUTOVER_DATABASE_ID).toBe("(default)");
    expect(PRODUCTION_CUTOVER_DATABASE_UID)
      .toBe("8dcf700f-01a3-4861-bee9-d901504f26b4");
    expect(PRODUCTION_CUTOVER_DATA_PRINCIPAL)
      .toBe("transition-cutover-data@okmarine-tankrental.iam.gserviceaccount.com");
    expect(PRODUCTION_CUTOVER_OPERATOR_PRINCIPAL).toBe("user:okmarineclub@gmail.com");
    expect(PRODUCTION_RESET_CONFIRMATION).not.toBe(PRODUCTION_RESTORE_CONFIRMATION);
  });

  it("5境界が固定transition v1契約へ完全armedされている", () => {
    expect(probeProductionExecuteGatePosture()).toBe("armed_for_fixed_transition_v1");
  });

  it("resetとrestoreのconfirmationおよびintentを相互利用できない", () => {
    expect(() => createProductionExecutionIntent({
      ...intentInput("reset"),
      confirmation: PRODUCTION_RESTORE_CONFIRMATION,
    })).toThrow("confirmation");
    expect(() => createProductionExecutionIntent({
      ...intentInput("restore"),
      confirmation: PRODUCTION_RESET_CONFIRMATION,
    })).toThrow("confirmation");
    expect(() => assertResetCliExecutionAllowed({
      execute: true,
      intent: intent("restore"),
    })).toThrow("reset用");
  });

  it("production CLIは全期待値を一度だけ要求し、旧tokenを拒否する", () => {
    const argv = executionArguments("reset");
    expect(() => createProductionExecutionIntentFromCli({
      ...cliContext("reset"),
      argv,
    })).not.toThrow();
    expect(() => createProductionExecutionIntentFromCli({
      ...cliContext("reset"),
      argv: argv.filter((value) => !value.startsWith("--expected-reset-plan-sha256=")),
    })).toThrow("一度だけ");
    expect(() => createProductionExecutionIntentFromCli({
      ...cliContext("reset"),
      argv: [...argv, "--expected-snapshot-id=duplicate"],
    })).toThrow("一度だけ");
    expect(() => createProductionExecutionIntentFromCli({
      ...cliContext("reset"),
      argv: argv.map((value) => value.startsWith("--confirm=")
        ? "--confirm=RESET_TRANSITION_PLAN_V1"
        : value),
    })).toThrow("confirmation");
  });

  it.each([
    ["projectId", "other-project"],
    ["databaseId", "other"],
    ["databaseUid", "other-uid"],
    ["dataPrincipal", "other@okmarine-tankrental.iam.gserviceaccount.com"],
    ["operatorPrincipal", "user:other@example.com"],
  ] as const)("固定identityの%s不一致をintent作成時に拒否する", (key, value) => {
    expect(() => createProductionExecutionIntent({
      ...intentInput("reset"),
      [key]: value,
    })).toThrow("固定契約");
  });

  it("production serviceはplain planからcommit認可を発行しない", () => {
    expect(() => authorizeResetServiceExecution({
      intent: intent("reset"),
      plan: {
        writes: WRITES,
        requestBytes: 1,
        resetAt: "2026-07-18T00:00:00Z",
        summary: {
          counts: { tanks: 1, tankLogs: 0, transactions: 0 },
          statusCounts: { empty: 1 },
          writes: 1,
          requestBytes: 1,
          snapshotId: "snapshot-001",
          snapshotPayloadSha256: "b".repeat(64),
          sourceCensusSha256: "c".repeat(64),
          resetPlanSha256: "d".repeat(64),
        },
      } as TransitionResetPlan,
    })).toThrow("凍結plan");
  });

  it("plain intent・authorizationなしのproduction経路を拒否する", () => {
    expect(() => assertResetCliExecutionAllowed({
      execute: true,
      intent: {} as ProductionExecutionIntent,
    })).toThrow("intent");
    expect(() => assertFirestoreCommitAllowed({
      operation: "reset",
      projectId: CUTOVER_PROJECT_ID,
      databaseId: PRODUCTION_CUTOVER_DATABASE_ID,
      databaseUid: PRODUCTION_CUTOVER_DATABASE_UID,
      dataPrincipal: PRODUCTION_CUTOVER_DATA_PRINCIPAL,
      serializedRequestBody: serializeFirestoreRestBody({ writes: WRITES }),
      writeCount: WRITES.length,
    })).toThrow("authorization");
  });

  it("dry-runとEmulatorはproduction authorizationなしで通す", () => {
    expect(() => assertResetCliExecutionAllowed({ execute: false })).not.toThrow();
    expect(() => assertRestoreCliExecutionAllowed({
      execute: true,
      emulatorHost: "127.0.0.1:8080",
    })).not.toThrow();
    expect(authorizeResetServiceExecution({
      emulatorHost: "127.0.0.1:8080",
      plan: {} as TransitionResetPlan,
    })).toBeUndefined();
    expect(() => assertFirestoreCommitAllowed({
      emulatorHost: "127.0.0.1:8080",
      operation: "reset",
      projectId: "demo-cutover",
      databaseId: "(default)",
      databaseUid: "emulator:demo-cutover:(default)",
      dataPrincipal: undefined,
      serializedRequestBody: serializeFirestoreRestBody({ writes: WRITES }),
      writeCount: WRITES.length,
    })).not.toThrow();
  });
});

function intent(operation: ProductionCutoverOperation): ProductionExecutionIntent {
  return createProductionExecutionIntent(intentInput(operation));
}

function intentInput(operation: ProductionCutoverOperation) {
  return {
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
    snapshotId: "snapshot-001",
    snapshotPayloadSha256: "b".repeat(64),
    sourceCensusSha256: "c".repeat(64),
    resetPlanSha256: "d".repeat(64),
  };
}

function cliContext(operation: ProductionCutoverOperation) {
  return {
    operation,
    projectId: CUTOVER_PROJECT_ID,
    databaseId: PRODUCTION_CUTOVER_DATABASE_ID,
    databaseUid: PRODUCTION_CUTOVER_DATABASE_UID,
    dataPrincipal: PRODUCTION_CUTOVER_DATA_PRINCIPAL,
    mainCommit: "a".repeat(40),
  };
}

function executionArguments(operation: ProductionCutoverOperation): string[] {
  const expected = intentInput(operation);
  return [
    `--confirm=${expected.confirmation}`,
    `--operator-principal=${expected.operatorPrincipal}`,
    `--expected-snapshot-id=${expected.snapshotId}`,
    `--expected-snapshot-payload-sha256=${expected.snapshotPayloadSha256}`,
    `--expected-source-census-sha256=${expected.sourceCensusSha256}`,
    `--expected-reset-plan-sha256=${expected.resetPlanSha256}`,
  ];
}
