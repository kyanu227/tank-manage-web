import {
  createSnapshotRestClient,
  parseSnapshotCommonArguments,
  reportCutoverCliError,
  requiredAbsolutePath,
} from "./cutover/snapshot-cli-common";
import {
  encryptTransitionSnapshot,
  snapshotEnvelopeSha256,
  writeEncryptedSnapshotFile,
} from "./cutover/snapshot-envelope";
import {
  disposeSnapshotKey,
  loadSnapshotEncryptionKey,
} from "./cutover/snapshot-key-provider";
import { captureTransitionSnapshot } from "./cutover/transition-snapshot-service";

main().catch((error) => {
  reportCutoverCliError(error);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const args = parseSnapshotCommonArguments(argv, ["--output"]);
  const outputPath = requiredAbsolutePath(argv, "--output");
  const client = await createSnapshotRestClient(args);
  const key = await loadSnapshotEncryptionKey({
    projectId: args.projectId,
    keyId: args.keyId,
    source: args.keySource,
    emulatorHost: args.emulatorHost,
  });
  try {
    const payload = await captureTransitionSnapshot({
      client,
      databaseUid: args.databaseUid,
      mainCommit: args.mainCommit,
      keyId: args.keyId,
    });
    const envelope = encryptTransitionSnapshot(payload, key);
    await writeEncryptedSnapshotFile(outputPath, envelope, {
      repositoryRoot: args.repositoryRoot,
      storageMode: args.snapshotStorageMode,
    });
    console.log(JSON.stringify({
      created: true,
      projectId: args.projectId,
      databaseId: args.databaseId,
      snapshotId: payload.manifest.snapshotId,
      keyId: payload.manifest.keyId,
      counts: payload.manifest.counts,
      inventory: payload.manifest.inventory,
      documentPathSha256: payload.manifest.documentPathSha256,
      sourceCensusSha256: payload.manifest.sourceCensusSha256,
      snapshotDocumentsSha256: payload.manifest.snapshotDocumentsSha256,
      payloadSha256: envelope.payloadSha256,
      envelopeSha256: snapshotEnvelopeSha256(envelope),
    }, null, 2));
  } finally {
    disposeSnapshotKey(key);
  }
}
