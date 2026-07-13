import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  decryptTransitionSnapshot,
  readEncryptedSnapshotFile,
} from "./cutover/snapshot-envelope";
import {
  emulatorDatabaseUid,
  FirestoreRestClient,
} from "./cutover/firestore-rest-client";
import type {
  FirestoreRestValue,
  FirestoreWrite,
  TransitionSnapshotPayloadV1,
} from "./cutover/firestore-rest-types";
import {
  TRANSITION_MIGRATION_MARKER_PATH,
  planTransitionSnapshotRestore,
  readTransitionSourceCensus,
  resetProjectionFieldsFromSnapshot,
} from "./cutover/transition-snapshot-service";

const ROOT = resolve(import.meta.dirname, "..");
const PROJECT_ID = "demo-transition-cutover";
const DATABASE_ID = "(default)";
const DATABASE_UID = emulatorDatabaseUid(PROJECT_ID, DATABASE_ID);
const DATABASE_PREFIX = `projects/${PROJECT_ID}/databases/${DATABASE_ID}`;
const KEY_ID = "emulator-key-001";
const MAIN_COMMIT = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: ROOT,
  encoding: "utf8",
}).trim();
const EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST?.trim();

if (!EMULATOR_HOST) throw new Error("FIRESTORE_EMULATOR_HOSTがありません");

const client = new FirestoreRestClient({
  projectId: PROJECT_ID,
  databaseId: DATABASE_ID,
  emulatorHost: EMULATOR_HOST,
});
const key = randomBytes(32);
const tempDirectory = await mkdtemp(join(tmpdir(), "tank-cutover-roundtrip-"));

try {
  await seedProductionShapeFixture();
  await verifySubcollectionFailClosed();

  const firstSnapshotPath = join(tempDirectory, "snapshot-1.cutover.enc");
  await runSnapshotCreate(firstSnapshotPath);
  const firstEnvelope = await readEncryptedSnapshotFile(firstSnapshotPath, { repositoryRoot: ROOT });
  const firstPayload = decryptTransitionSnapshot(firstEnvelope, key, KEY_ID);
  assertCounts(firstPayload, { tanks: 145, tankLogs: 38, transactions: 8, restoreWrites: 192 });
  assert(firstPayload.manifest.inventory.preservedNonTankLogs === 1, "preserved log count");
  assert(firstPayload.manifest.inventory.preservedTransactions === 1, "preserved transaction count");
  assert(
    tankField(firstPayload, "T-001", "negativeZero", "doubleValue") === 0,
    "snapshot preserves the double type while normalizing Firestore -0.0 to 0.0",
  );

  await applyFixtureReset(firstPayload, firstEnvelope.payloadSha256, "2026-07-13T02:00:00Z");
  await changeMarkerSnapshotId("wrong-snapshot-id");
  await runSnapshotRestoreExpectFailure(firstSnapshotPath, "snapshot ID");
  await changeMarkerSnapshotId(firstPayload.manifest.snapshotId);
  await client.commit([createWrite("logs/L-001", {
    logKind: { stringValue: "tank" },
    tankId: { stringValue: "T-001" },
  })]);
  await runSnapshotRestoreExpectFailure(firstSnapshotPath, "対象tank log");
  await client.commit([{ delete: client.fullDocumentName("logs/L-001") }]);
  await verifyMissingTargetSubcollectionFailClosed(firstSnapshotPath);
  await changeResetTimestamp("tanks/T-001", "2026-07-13T02:00:01Z");
  await runSnapshotRestoreExpectFailure(firstSnapshotPath, "期待状態");
  await changeResetTimestamp("tanks/T-001", "2026-07-13T02:00:00Z");
  const dryRun = await runSnapshotRestore(firstSnapshotPath, false);
  assert(dryRun.mode === "dry-run", "restore dry-run mode");
  assert(dryRun.writes === 192, "restore dry-run write count");
  assert(typeof dryRun.requestBytes === "number" && dryRun.requestBytes < 8 * 1024 * 1024, "request bytes");
  await assertResetStillPresent();

  const executed = await runSnapshotRestore(firstSnapshotPath, true);
  assert(executed.mode === "executed", "restore execute mode");
  assert(typeof executed.commitTime === "string", "restore commit time");
  assert(executed.commitResponse === "confirmed", "restore commit response");
  await assertRestored(firstPayload);

  // 二回目はstale updateTimeによるcommit全体のatomic failureを確認する。
  const secondSnapshotPath = join(tempDirectory, "snapshot-2.cutover.enc");
  await runSnapshotCreate(secondSnapshotPath);
  const secondEnvelope = await readEncryptedSnapshotFile(secondSnapshotPath, { repositoryRoot: ROOT });
  const secondPayload = decryptTransitionSnapshot(secondEnvelope, key, KEY_ID);
  await applyFixtureReset(secondPayload, secondEnvelope.payloadSha256, "2026-07-13T03:00:00Z");
  const stalePlan = await planTransitionSnapshotRestore({
    client,
    payload: secondPayload,
    snapshotPayloadSha256: secondEnvelope.payloadSha256,
    expectedProjectId: PROJECT_ID,
    expectedDatabaseId: DATABASE_ID,
    expectedDatabaseUid: DATABASE_UID,
    expectedMainCommit: MAIN_COMMIT,
  });
  await changeResetTimestamp("tanks/T-001", "2026-07-13T03:00:01Z");
  let staleCommitFailed = false;
  try {
    await client.commit(stalePlan.writes);
  } catch {
    staleCommitFailed = true;
  }
  assert(staleCommitFailed, "stale restore commit must fail");
  await assertResetStillPresent();

  await changeResetTimestamp("tanks/T-001", "2026-07-13T03:00:00Z");
  await runSnapshotRestore(secondSnapshotPath, true);
  await assertRestored(secondPayload);
  console.log(
    `PASS typed encrypted snapshot -> atomic reset fixture -> separate-process atomic restore `
    + `(145/38/8, 192 writes, ${String(dryRun.requestBytes)} bytes)`,
  );
} finally {
  key.fill(0);
  await rm(tempDirectory, { recursive: true, force: true });
}

async function seedProductionShapeFixture(): Promise<void> {
  const writes: FirestoreWrite[] = [];
  for (let index = 1; index <= 145; index += 1) {
    const id = `T-${String(index).padStart(3, "0")}`;
    const fields: Record<string, FirestoreRestValue> = {
      status: { stringValue: index % 2 === 0 ? "filled" : "lent" },
      location: { stringValue: index % 2 === 0 ? "倉庫" : "テスト顧客" },
      tankNumber: { stringValue: id },
      type: { stringValue: index % 2 === 0 ? "steel" : "aluminum" },
      capacity: { integerValue: String(index % 15 + 1) },
      purchasePrice: { doubleValue: index + 0.5 },
      updatedAt: { timestampValue: "2026-07-13T00:00:00.123456789Z" },
      ...(index <= 38 ? { latestLogId: { stringValue: `L-${String(index).padStart(3, "0")}` } } : {}),
    };
    if (index === 1) {
      Object.assign(fields, {
        negativeZero: { doubleValue: -0 },
        nanValue: { doubleValue: "NaN" },
        bytesValue: { bytesValue: Buffer.from("typed-snapshot").toString("base64") },
        referenceValue: {
          referenceValue: `${DATABASE_PREFIX}/documents/customers/customer-001`,
        },
        geoPointValue: { geoPointValue: { latitude: 35.6812, longitude: 139.7671 } },
        nestedValue: {
          mapValue: {
            fields: {
              list: {
                arrayValue: {
                  values: [{ integerValue: "1" }, { stringValue: "two" }, { nullValue: null }],
                },
              },
            },
          },
        },
      } satisfies Record<string, FirestoreRestValue>);
    }
    writes.push(createWrite(`tanks/${id}`, fields));
  }
  for (let index = 1; index <= 38; index += 1) {
    const suffix = String(index).padStart(3, "0");
    writes.push(createWrite(`logs/L-${suffix}`, {
      logKind: { stringValue: "tank" },
      tankId: { stringValue: `T-${suffix}` },
      action: { stringValue: "lend" },
      timestamp: { timestampValue: "2026-07-13T00:00:00.123456789Z" },
    }));
  }
  writes.push(createWrite("logs/PRESERVED-001", {
    logKind: { stringValue: "procurement" },
    note: { stringValue: "preserved" },
  }));
  const transactionTypes = ["order", "return", "uncharged_report"];
  for (let index = 1; index <= 8; index += 1) {
    writes.push(createWrite(`transactions/TX-${String(index).padStart(3, "0")}`, {
      type: { stringValue: transactionTypes[(index - 1) % transactionTypes.length] },
      status: { stringValue: "pending" },
      createdAt: { timestampValue: "2026-07-13T00:00:00Z" },
    }));
  }
  writes.push(createWrite("transactions/PRESERVED-001", {
    type: { stringValue: "procurement" },
    status: { stringValue: "pending" },
  }));
  await client.commit(writes);
}

async function verifySubcollectionFailClosed(): Promise<void> {
  await client.commit([createWrite("tanks/T-001/notes/N-001", {
    note: { stringValue: "must block limited snapshot" },
  })]);
  const blockedOutput = join(tempDirectory, "blocked.cutover.enc");
  const failed = await runCli(
    "scripts/create-transition-cutover-snapshot.mts",
    [...commonArguments(), `--output=${blockedOutput}`],
    false,
  );
  assert(failed.stderr.includes("subcollection"), "subcollection preflight failure");
  await client.commit([{ delete: client.fullDocumentName("tanks/T-001/notes/N-001") }]);

  await client.commit([createWrite(`${TRANSITION_MIGRATION_MARKER_PATH}/notes/N-001`, {
    note: { stringValue: "must block missing marker subcollection" },
  })]);
  const markerBlockedOutput = join(tempDirectory, "marker-blocked.cutover.enc");
  const markerFailed = await runCli(
    "scripts/create-transition-cutover-snapshot.mts",
    [...commonArguments(), `--output=${markerBlockedOutput}`],
    false,
  );
  assert(markerFailed.stderr.includes("subcollection"), "marker subcollection preflight failure");
  await client.commit([{
    delete: client.fullDocumentName(`${TRANSITION_MIGRATION_MARKER_PATH}/notes/N-001`),
  }]);
}

async function verifyMissingTargetSubcollectionFailClosed(snapshotPath: string): Promise<void> {
  const paths = ["logs/L-001/notes/N-001", "transactions/TX-001/notes/N-001"];
  await client.commit(paths.map((path) => createWrite(path, {
    note: { stringValue: "parent document is intentionally missing" },
  })));
  await runSnapshotRestoreExpectFailure(snapshotPath, "subcollection");
  await client.commit(paths.map((path) => ({ delete: client.fullDocumentName(path) })));
}

async function runSnapshotCreate(outputPath: string): Promise<Record<string, unknown>> {
  const result = await runCli(
    "scripts/create-transition-cutover-snapshot.mts",
    [...commonArguments(), `--output=${outputPath}`],
    true,
  );
  return parseJsonOutput(result.stdout);
}

async function runSnapshotRestore(
  snapshotPath: string,
  execute: boolean,
): Promise<Record<string, unknown>> {
  const result = await runCli(
    "scripts/restore-transition-cutover-snapshot.mts",
    [
      ...commonArguments(),
      `--snapshot=${snapshotPath}`,
      ...(execute ? ["--execute", "--confirm=RESTORE_TRANSITION_PLAN_V1"] : []),
    ],
    true,
  );
  return parseJsonOutput(result.stdout);
}

async function runSnapshotRestoreExpectFailure(
  snapshotPath: string,
  expectedMessage: string,
): Promise<void> {
  const result = await runCli(
    "scripts/restore-transition-cutover-snapshot.mts",
    [...commonArguments(), `--snapshot=${snapshotPath}`],
    false,
  );
  assert(result.stderr.includes(expectedMessage), `restore failure: ${expectedMessage}`);
}

function commonArguments(): string[] {
  return [
    `--project=${PROJECT_ID}`,
    `--database=${DATABASE_ID}`,
    `--expected-database-uid=${DATABASE_UID}`,
    `--expected-main-commit=${MAIN_COMMIT}`,
    `--key-id=${KEY_ID}`,
    "--test-key-stdin",
  ];
}

async function applyFixtureReset(
  payload: TransitionSnapshotPayloadV1,
  payloadSha256: string,
  resetAt: string,
): Promise<void> {
  const writes: FirestoreWrite[] = payload.documents.map((document) => {
    if (document.kind === "tank") {
      return {
        update: {
          name: document.name,
          fields: resetProjectionFieldsFromSnapshot(document, resetAt),
        },
        currentDocument: { updateTime: document.updateTime },
      };
    }
    return {
      delete: document.name,
      currentDocument: { updateTime: document.updateTime },
    };
  });
  writes.push({
    update: {
      name: client.fullDocumentName(TRANSITION_MIGRATION_MARKER_PATH),
      fields: {
        migration: { stringValue: "transitionPlanRequiredV1" },
        status: { stringValue: "completed" },
        snapshotId: { stringValue: payload.manifest.snapshotId },
        snapshotPayloadSha256: { stringValue: payloadSha256 },
        snapshotDocumentsSha256: { stringValue: payload.manifest.snapshotDocumentsSha256 },
        sourceCensusSha256: { stringValue: payload.manifest.sourceCensusSha256 },
        resetAt: { timestampValue: resetAt },
        completedAt: { timestampValue: resetAt },
      },
    },
    currentDocument: { exists: false },
  });
  assert(writes.length === 192, "fixture reset write count");
  await client.commit(writes);
}

async function assertResetStillPresent(): Promise<void> {
  const result = await client.batchGet([
    "tanks/T-001",
    "tanks/T-002",
    "logs/L-001",
    TRANSITION_MIGRATION_MARKER_PATH,
  ]);
  const tank1 = result.get(client.fullDocumentName("tanks/T-001"));
  const tank2 = result.get(client.fullDocumentName("tanks/T-002"));
  const log = result.get(client.fullDocumentName("logs/L-001"));
  const marker = result.get(client.fullDocumentName(TRANSITION_MIGRATION_MARKER_PATH));
  assert(restString(tank1?.fields?.status) === "empty", "tank 1 reset status");
  assert(restString(tank2?.fields?.status) === "empty", "tank 2 reset status");
  assert(log === null, "target log remains deleted");
  assert(restString(marker?.fields?.status) === "completed", "completed marker remains");
}

async function assertRestored(payload: TransitionSnapshotPayloadV1): Promise<void> {
  const census = await readTransitionSourceCensus(client);
  assert(census.markerDocument === null, "restore deletes marker");
  const expected = new Map(payload.documents.map((document) => [document.name, document.fieldSha256]));
  assert(census.documents.length === payload.documents.length, "restored document count");
  census.documents.forEach((document) => {
    assert(expected.get(document.name) === document.fieldSha256, `field hash: ${document.name}`);
  });
  assert(
    tankField(payload, "T-001", "negativeZero", "doubleValue") === 0,
    "payload retains normalized double zero after restore",
  );
  const restoredTank = census.documents.find((document) => document.name.endsWith("/tanks/T-001"));
  const restoredNegativeZero = restoredTank?.fields.negativeZero;
  assert(
    restoredNegativeZero && "doubleValue" in restoredNegativeZero
      && restoredNegativeZero.doubleValue === 0,
    "restored Firestore document retains normalized double zero",
  );
}

async function changeResetTimestamp(path: string, updatedAt: string): Promise<void> {
  const fullName = client.fullDocumentName(path);
  const current = (await client.batchGet([path])).get(fullName);
  if (!current?.updateTime) throw new Error(`${path}がありません`);
  await client.commit([{
    update: {
      name: fullName,
      fields: {
        ...(current.fields ?? {}),
        updatedAt: { timestampValue: updatedAt },
      },
    },
    currentDocument: { updateTime: current.updateTime },
  }]);
}

async function changeMarkerSnapshotId(snapshotId: string): Promise<void> {
  const fullName = client.fullDocumentName(TRANSITION_MIGRATION_MARKER_PATH);
  const current = (await client.batchGet([TRANSITION_MIGRATION_MARKER_PATH])).get(fullName);
  if (!current?.updateTime) throw new Error("migration markerがありません");
  await client.commit([{
    update: {
      name: fullName,
      fields: {
        ...(current.fields ?? {}),
        snapshotId: { stringValue: snapshotId },
      },
    },
    currentDocument: { updateTime: current.updateTime },
  }]);
}

function createWrite(
  relativePath: string,
  fields: Record<string, FirestoreRestValue>,
): FirestoreWrite {
  return {
    update: { name: client.fullDocumentName(relativePath), fields },
    currentDocument: { exists: false },
  };
}

function runCli(
  script: string,
  args: string[],
  expectSuccess: boolean,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, ["--import", "tsx", script, ...args], {
      cwd: ROOT,
      env: { ...process.env, FIRESTORE_EMULATOR_HOST: EMULATOR_HOST },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", rejectPromise);
    child.on("close", (code) => {
      if ((code === 0) !== expectSuccess) {
        rejectPromise(new Error(
          `${script} ${expectSuccess ? "failed" : "unexpectedly succeeded"} (exit ${code})\n${stderr}\n${stdout}`,
        ));
        return;
      }
      resolvePromise({ stdout, stderr });
    });
    child.stdin.end(`${key.toString("base64")}\n`);
  });
}

function parseJsonOutput(stdout: string): Record<string, unknown> {
  try {
    return JSON.parse(stdout) as Record<string, unknown>;
  } catch {
    throw new Error(`CLI outputがJSONではありません:\n${stdout}`);
  }
}

function restString(value: FirestoreRestValue | undefined): string {
  return value && "stringValue" in value ? value.stringValue : "";
}

function assertCounts(
  payload: TransitionSnapshotPayloadV1,
  expected: TransitionSnapshotPayloadV1["manifest"]["counts"],
): void {
  assert(JSON.stringify(payload.manifest.counts) === JSON.stringify(expected), "snapshot counts");
}

function tankField(
  payload: TransitionSnapshotPayloadV1,
  tankId: string,
  fieldName: string,
  unionKey: "doubleValue",
): unknown {
  const tank = payload.documents.find((document) => document.name.endsWith(`/tanks/${tankId}`));
  const value = tank?.fields[fieldName];
  return value && unionKey in value ? value[unionKey] : undefined;
}

function assert(condition: unknown, label: string): asserts condition {
  if (!condition) throw new Error(`ASSERTION FAILED: ${label}`);
}
