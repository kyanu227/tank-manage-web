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
import { assertRestoreCliExecutionAllowed } from "./cutover/production-execute-gates";

const EXECUTE_CONFIRMATION = "RESTORE_TRANSITION_PLAN_V1";

main().catch((error) => {
  reportCutoverCliError(error);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const args = parseSnapshotCommonArguments(argv, ["--snapshot", "--execute", "--confirm"]);
  const snapshotPath = requiredAbsolutePath(argv, "--snapshot");
  const execute = argv.includes("--execute");
  if (execute && argumentValue(argv, "--confirm") !== EXECUTE_CONFIRMATION) {
    throw new Error(`実行には --confirm=${EXECUTE_CONFIRMATION} が必要です`);
  }
  assertRestoreCliExecutionAllowed({ execute, emulatorHost: args.emulatorHost });
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
    const client = await createSnapshotRestClient(args);
    const restoreOptions = {
      client,
      payload,
      snapshotPayloadSha256: envelope.payloadSha256,
      expectedProjectId: args.projectId,
      expectedDatabaseId: args.databaseId,
      expectedDatabaseUid: args.databaseUid,
      expectedMainCommit: args.mainCommit,
    };
    const result = execute
      ? await executeTransitionSnapshotRestore(restoreOptions)
      : await planTransitionSnapshotRestore(restoreOptions);
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
    }, null, 2));
  } finally {
    disposeSnapshotKey(key);
  }
}
