import {
  argumentValue,
  createSnapshotRestClient,
  parseSnapshotCommonArguments,
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

const EXECUTE_CONFIRMATION = "RESET_TRANSITION_PLAN_V1";

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
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
  if (execute && !args.emulatorHost) {
    throw new Error(
      "本番reset executeはfreeze Rules・rules bypass writer停止・runbookの実装PRが完了するまで無効です",
    );
  }

  const envelope = await readEncryptedSnapshotFile(snapshotPath, {
    repositoryRoot: args.repositoryRoot,
  });
  const key = await loadSnapshotEncryptionKey({
    projectId: args.projectId,
    keyId: args.keyId,
    source: args.keySource,
    emulatorHost: args.emulatorHost,
  });
  try {
    const payload = decryptTransitionSnapshot(envelope, key, args.keyId);
    const client = createSnapshotRestClient(args);
    const resetOptions = {
      client,
      payload,
      snapshotPayloadSha256: envelope.payloadSha256,
      expectedProjectId: args.projectId,
      expectedDatabaseId: args.databaseId,
      expectedDatabaseUid: args.databaseUid,
      expectedMainCommit: args.mainCommit,
    };
    const result = execute
      ? await executeTransitionSnapshotReset(resetOptions)
      : await planTransitionSnapshotReset(resetOptions);

    // stdoutはrunbookで比較できる非機密summaryだけに限定する。
    console.log(JSON.stringify({
      mode: execute ? "executed" : "dry-run",
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
    }, null, 2));
  } finally {
    disposeSnapshotKey(key);
  }
}
