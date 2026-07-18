import {
  argumentValue,
  createSnapshotRestRuntime,
  parseSnapshotCommonArguments,
  reportCutoverCliError,
  requiredAbsolutePath,
} from "./cutover/snapshot-cli-common";
import {
  decryptTransitionSnapshot,
  readEncryptedSnapshotFile,
} from "./cutover/snapshot-envelope";
import {
  disposeSnapshotKey,
  loadSnapshotEncryptionKey,
} from "./cutover/snapshot-key-provider";
import {
  executeTransitionSnapshotReset,
  planTransitionSnapshotReset,
} from "./cutover/transition-reset-service";
import {
  assertResetCliExecutionAllowed,
  authorizeResetServiceExecution,
} from "./cutover/production-execute-gates";
import {
  PRODUCTION_RESET_CONFIRMATION,
  createProductionExecutionIntentFromCli,
  emulatorExecutionIdentity,
  productionExecutionIdentity,
} from "./cutover/production-execution-contract";
import { verifyTransitionCutoverState } from "./cutover/transition-cutover-verifier";

const EXECUTE_ARGUMENT_NAMES = [
  "--operator-principal",
  "--expected-snapshot-id",
  "--expected-snapshot-payload-sha256",
  "--expected-source-census-sha256",
  "--expected-reset-plan-sha256",
] as const;

main().catch((error) => {
  reportCutoverCliError(error);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const args = parseSnapshotCommonArguments(argv, [
    "--snapshot",
    "--execute",
    "--confirm",
    ...EXECUTE_ARGUMENT_NAMES,
  ]);
  const snapshotPath = requiredAbsolutePath(argv, "--snapshot");
  const execute = argv.includes("--execute");
  const executionIdentity = args.emulatorHost
    ? emulatorExecutionIdentity()
    : productionExecutionIdentity();
  const executionIntent = execute && !args.emulatorHost
    ? createProductionExecutionIntentFromCli({
        operation: "reset",
        argv,
        projectId: args.projectId,
        databaseId: args.databaseId,
        databaseUid: args.databaseUid,
        dataPrincipal: args.expectedDataPrincipal ?? "",
        mainCommit: args.mainCommit,
      })
    : undefined;
  if (execute && args.emulatorHost && argumentValue(argv, "--confirm") !== PRODUCTION_RESET_CONFIRMATION) {
    throw new Error(`実行には --confirm=${PRODUCTION_RESET_CONFIRMATION} が必要です`);
  }
  assertResetCliExecutionAllowed({
    execute,
    emulatorHost: args.emulatorHost,
    intent: executionIntent,
  });

  const envelope = await readEncryptedSnapshotFile(snapshotPath, {
    repositoryRoot: args.repositoryRoot,
    storageMode: args.snapshotStorageMode,
  });
  const key = await loadSnapshotEncryptionKey({
    projectId: args.projectId,
    keyId: args.keyId,
    source: args.keySource,
    emulatorHost: args.emulatorHost,
  });
  try {
    const payload = decryptTransitionSnapshot(envelope, key, args.keyId);
    const runtime = await createSnapshotRestRuntime(args);
    const client = runtime.client;
    const resetOptions = {
      client,
      payload,
      snapshotPayloadSha256: envelope.payloadSha256,
      expectedProjectId: args.projectId,
      expectedDatabaseId: args.databaseId,
      expectedDatabaseUid: args.databaseUid,
      expectedMainCommit: args.mainCommit,
      executionIdentity,
      executionIntent,
      resetProductionAuthorizationProvider: (plan: Parameters<
        typeof authorizeResetServiceExecution
      >[0]["plan"]) => authorizeResetServiceExecution({
        emulatorHost: args.emulatorHost,
        intent: executionIntent,
        plan,
      }),
    };
    const result = execute
      ? await executeTransitionSnapshotReset(resetOptions)
      : await planTransitionSnapshotReset(resetOptions);
    const verification = execute
      ? await verifyTransitionCutoverState({
          ...resetOptions,
          observationDelaysMs: [100, 400],
        })
      : null;
    if (verification && verification.status !== "reset_applied") {
      throw new Error("reset execute直後のverify-onlyで完全適用を確認できません");
    }

    // stdoutはrunbookで比較できる非機密summaryだけに限定する。
    console.log(JSON.stringify({
      mode: execute ? "executed" : "dry-run",
      snapshotId: result.summary.snapshotId,
      counts: result.summary.counts,
      statusCounts: result.summary.statusCounts,
      writes: result.summary.writes,
      requestBytes: result.summary.requestBytes,
      hashes: {
        snapshotPayloadSha256: result.summary.snapshotPayloadSha256,
        sourceCensusSha256: result.summary.sourceCensusSha256,
        resetPlanSha256: result.summary.resetPlanSha256,
      },
      ...("commitTime" in result ? { commitTime: result.commitTime } : {}),
      ...("commitResponse" in result ? { commitResponse: result.commitResponse } : {}),
      ...(verification ? {
        verifyOnly: {
          status: verification.status,
          observations: verification.observations,
          safeToRetry: verification.safeToRetry,
          stableStateSha256: verification.stableStateSha256,
        },
      } : {}),
    }, null, 2));
  } finally {
    disposeSnapshotKey(key);
  }
}
