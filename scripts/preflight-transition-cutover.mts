import { canonicalSha256 } from "./cutover/canonical-firestore-value";
import {
  createSnapshotRestRuntime,
  parseSnapshotCommonArguments,
  reportCutoverCliError,
} from "./cutover/snapshot-cli-common";
import { planTransitionSnapshotReset } from "./cutover/transition-reset-service";
import { captureTransitionSnapshot } from "./cutover/transition-snapshot-service";
import { createDataReadinessEvidence } from "./cutover/readiness-evidence";

main().catch((error) => {
  reportCutoverCliError(error);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const readinessEvidence = argv.includes("--readiness-evidence");
  if (argv.some((argument) => argument.startsWith("--readiness-evidence="))) {
    throw new Error("--readiness-evidenceは値なしflagです");
  }
  const args = parseSnapshotCommonArguments(argv, ["--readiness-evidence"]);
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

  const summary = {
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
  };
  // 既存commandのstdout契約は維持し、明示flag時だけreadiness証跡へ封入する。
  if (!readinessEvidence) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }
  if (args.emulatorHost) throw new Error("readiness evidenceはproduction read-only preflight専用です");
  if (!args.expectedDataPrincipal) {
    throw new Error("本番preflightのdata principalがありません");
  }
  // document ID、顧客名、location、field、credential path、principal本文はstdoutへ出さない。
  console.log(JSON.stringify(createDataReadinessEvidence({
    generatedAt: new Date().toISOString(),
    projectId: args.projectId,
    databaseId: args.databaseId,
    databaseUid: args.databaseUid,
    mainCommit: args.mainCommit,
    principal: args.expectedDataPrincipal,
    payload: {
      counts: plan.summary.counts,
      statusCounts: plan.summary.statusCounts,
      writes: plan.summary.writes,
      requestBytes: plan.summary.requestBytes,
      sourceCensusSha256: plan.summary.sourceCensusSha256,
      documentPathSha256: payload.manifest.documentPathSha256,
    },
  }), null, 2));
}
