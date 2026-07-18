import {
  argumentValue,
  createSnapshotRestClient,
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
import { verifyTransitionCutoverState } from "./cutover/transition-cutover-verifier";
import {
  emulatorExecutionIdentity,
  productionExecutionIdentity,
} from "./cutover/production-execution-contract";

type CutoverOperation = "reset" | "restore";

main().catch((error) => {
  reportCutoverCliError(error);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const args = parseSnapshotCommonArguments(argv, ["--snapshot", "--operation"]);
  const snapshotPath = requiredAbsolutePath(argv, "--snapshot");
  const operation = requireOperation(argumentValue(argv, "--operation"));
  const client = await createSnapshotRestClient(args);
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
    const result = await verifyTransitionCutoverState({
      client,
      payload,
      snapshotPayloadSha256: envelope.payloadSha256,
      expectedProjectId: args.projectId,
      expectedDatabaseId: args.databaseId,
      expectedDatabaseUid: args.databaseUid,
      expectedMainCommit: args.mainCommit,
      executionIdentity: args.emulatorHost
        ? emulatorExecutionIdentity()
        : productionExecutionIdentity(),
    });
    const targetStateConfirmed = operation === "reset"
      ? result.status === "reset_applied"
      : result.status === "source_or_restored_observed";

    // document、principal、path、鍵は出力せず、反復観測の判定だけを返す。
    console.log(JSON.stringify({
      mode: "verify-only",
      operation,
      observedState: result.status,
      targetStateConfirmed,
      safeToRetry: result.safeToRetry,
      observations: result.observations,
      stableStateSha256: result.stableStateSha256,
    }, null, 2));
    if (!targetStateConfirmed) process.exitCode = 2;
  } finally {
    disposeSnapshotKey(key);
  }
}

function requireOperation(value: string): CutoverOperation {
  if (value !== "reset" && value !== "restore") {
    throw new Error("--operation=reset または --operation=restore を指定してください");
  }
  return value;
}
