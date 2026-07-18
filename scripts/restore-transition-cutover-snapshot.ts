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
  snapshotEnvelopeSha256,
} from "./cutover/snapshot-envelope";
import {
  disposeSnapshotKey,
  loadSnapshotEncryptionKey,
} from "./cutover/snapshot-key-provider";
import {
  executeTransitionSnapshotRestore,
  planTransitionSnapshotRestore,
} from "./cutover/transition-snapshot-service";
import {
  assertRestoreCliExecutionAllowed,
  authorizeRestoreServiceExecution,
} from "./cutover/production-execute-gates";
import {
  PRODUCTION_RESTORE_CONFIRMATION,
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
        operation: "restore",
        argv,
        projectId: args.projectId,
        databaseId: args.databaseId,
        databaseUid: args.databaseUid,
        dataPrincipal: args.expectedDataPrincipal ?? "",
        mainCommit: args.mainCommit,
      })
    : undefined;
  if (
    execute
    && args.emulatorHost
    && argumentValue(argv, "--confirm") !== PRODUCTION_RESTORE_CONFIRMATION
  ) {
    throw new Error(`実行には --confirm=${PRODUCTION_RESTORE_CONFIRMATION} が必要です`);
  }
  assertRestoreCliExecutionAllowed({
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
    const restoreOptions = {
      client,
      payload,
      snapshotPayloadSha256: envelope.payloadSha256,
      expectedProjectId: args.projectId,
      expectedDatabaseId: args.databaseId,
      expectedDatabaseUid: args.databaseUid,
      expectedMainCommit: args.mainCommit,
      executionIdentity,
      executionIntent,
      restoreProductionAuthorizationProvider: (plan: Parameters<
        typeof authorizeRestoreServiceExecution
      >[0]["plan"]) => authorizeRestoreServiceExecution({
        emulatorHost: args.emulatorHost,
        intent: executionIntent,
        plan,
      }),
    };
    const result = execute
      ? await executeTransitionSnapshotRestore(restoreOptions)
      : await planTransitionSnapshotRestore(restoreOptions);
    const verification = execute
      ? await verifyTransitionCutoverState({
          ...restoreOptions,
          observationDelaysMs: [100, 400],
        })
      : null;
    if (verification && verification.status !== "source_or_restored_observed") {
      throw new Error("restore execute直後のverify-onlyで完全復元を確認できません");
    }
    console.log(JSON.stringify({
      mode: execute ? "executed" : "dry-run",
      projectId: args.projectId,
      databaseId: args.databaseId,
      keyId: args.keyId,
      payloadSha256: envelope.payloadSha256,
      envelopeSha256: snapshotEnvelopeSha256(envelope),
      ...result.summary,
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
