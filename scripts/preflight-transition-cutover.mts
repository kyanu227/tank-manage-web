import { canonicalSha256 } from "./cutover/canonical-firestore-value";
import {
  createSnapshotRestRuntime,
  parseSnapshotCommonArguments,
  reportCutoverCliError,
} from "./cutover/snapshot-cli-common";
import { planTransitionSnapshotReset } from "./cutover/transition-reset-service";
import { captureTransitionSnapshot } from "./cutover/transition-snapshot-service";

main().catch((error) => {
  reportCutoverCliError(error);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const args = parseSnapshotCommonArguments(process.argv.slice(2), []);
  const runtime = await createSnapshotRestRuntime(args);
  const payload = await captureTransitionSnapshot({
    client: runtime.client,
    databaseUid: args.databaseUid,
    mainCommit: args.mainCommit,
    keyId: args.keyId,
  });
  const snapshotPayloadSha256 = canonicalSha256(payload);
  const plan = await planTransitionSnapshotReset({
    client: runtime.client,
    payload,
    snapshotPayloadSha256,
    expectedProjectId: args.projectId,
    expectedDatabaseId: args.databaseId,
    expectedDatabaseUid: args.databaseUid,
    expectedMainCommit: args.mainCommit,
  });

  // document ID、顧客名、location、field、credential pathはstdoutへ出さない。
  console.log(JSON.stringify({
    mode: "read-only-preflight",
    credential: {
      kind: runtime.credential?.kind ?? "emulator",
      expectedDataPrincipalConfirmed: runtime.credential !== null,
      requiredPermissionsConfirmed: runtime.credential !== null,
      requiredPermissionCount: runtime.credential?.permissions.length ?? 0,
    },
    counts: plan.summary.counts,
    inventory: payload.manifest.inventory,
    statusCounts: plan.summary.statusCounts,
    writes: plan.summary.writes,
    requestBytes: plan.summary.requestBytes,
    hashes: {
      sourceCensusSha256: plan.summary.sourceCensusSha256,
      documentPathSha256: payload.manifest.documentPathSha256,
    },
  }, null, 2));
}
