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
  readTransitionSourceCensus,
  sourceCensusSha256,
} from "./cutover/transition-snapshot-service";
import { planTransitionSnapshotReset } from "./cutover/transition-reset-service";

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
    tankMetadataValue(firstPayload, "T-001", "negativeZero", "doubleValue") === 0,
    "snapshot preserves the double type while normalizing Firestore -0.0 to 0.0",
  );
  const zeroGeoPoint = tankMetadata(firstPayload, "T-001", "zeroGeoPoint");
  assert(
    zeroGeoPoint && "geoPointValue" in zeroGeoPoint
      && zeroGeoPoint.geoPointValue.latitude === 0
      && zeroGeoPoint.geoPointValue.longitude === 0,
    "snapshot canonicalizes omitted ProtoJSON GeoPoint zero axes",
  );

  await verifyResetPreflightFailClosed(firstSnapshotPath);
  const beforeResetDryRunSha = sourceCensusSha256(await readTransitionSourceCensus(client));
  const resetDryRun = await runSnapshotResetViaNpmSilent(firstSnapshotPath);
  assert(resetDryRun.output.mode === "dry-run", "reset dry-run mode");
  assert(resetDryRun.output.writes === 192, "reset dry-run write count");
  const resetRequestBytes = resetDryRun.output.requestBytes;
  assert(
    typeof resetRequestBytes === "number" && resetRequestBytes < 8 * 1024 * 1024,
    "reset request bytes",
  );
  assertSafeResetStdout(resetDryRun.stdout, firstPayload);
  await assertSourceStillPresent(beforeResetDryRunSha);

  const resetExecuted = await runSnapshotReset(firstSnapshotPath, true);
  assert(resetExecuted.output.mode === "executed", "reset execute mode");
  assert(resetExecuted.output.writes === 192, "reset execute write count");
  assert(resetExecuted.output.commitResponse === "confirmed", "reset commit response");
  assert(
    resetPlanHash(resetExecuted.output) === resetPlanHash(resetDryRun.output),
    "reset dry-run and execute plan hashes match",
  );
  assertSafeResetStdout(resetExecuted.stdout, firstPayload);
  await assertResetStillPresent();
  const firstResetAt = await resetTimestampFromMarker();

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
  await changeResetTimestamp("tanks/T-001", firstResetAt);
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

  // snapshot後の各precondition競合で192-write全体が一件も適用されないことを確認する。
  await assertAtomicResetRaceRejected("stale-tank", async () => {
    await changeDocumentField("tanks/T-001", "note", { stringValue: "stale reset precondition" });
  });
  await assertAtomicResetRaceRejected("stale-log", async () => {
    await changeDocumentField("logs/L-001", "raceProbe", { stringValue: "stale-log" });
  });
  await assertAtomicResetRaceRejected("stale-transaction", async () => {
    await changeDocumentField("transactions/TX-001", "raceProbe", {
      stringValue: "stale-transaction",
    });
  });
  await assertAtomicResetRaceRejected("marker-exists", async () => {
    await client.commit([createWrite(TRANSITION_MIGRATION_MARKER_PATH, {
      status: { stringValue: "in_progress" },
    })]);
  }, true);
  await client.commit([{ delete: client.fullDocumentName(TRANSITION_MIGRATION_MARKER_PATH) }]);

  const finalSnapshotPath = join(tempDirectory, "snapshot-final.cutover.enc");
  await runSnapshotCreate(finalSnapshotPath);
  const finalEnvelope = await readEncryptedSnapshotFile(finalSnapshotPath, { repositoryRoot: ROOT });
  const finalPayload = decryptTransitionSnapshot(finalEnvelope, key, KEY_ID);
  await runSnapshotReset(finalSnapshotPath, true);
  await runSnapshotRestore(finalSnapshotPath, true);
  await assertRestored(finalPayload);
  console.log(
    `PASS typed encrypted snapshot -> separate-process atomic reset -> atomic restore `
    + `(145/38/8, 192 writes, reset=${String(resetRequestBytes)} bytes, `
    + `restore=${String(dryRun.requestBytes)} bytes)`,
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
        note: {
          mapValue: {
            fields: {
              negativeZero: { doubleValue: -0 },
              nanValue: { doubleValue: "NaN" },
              bytesValue: { bytesValue: Buffer.from("typed-snapshot").toString("base64") },
              referenceValue: {
                referenceValue: `${DATABASE_PREFIX}/documents/customers/customer-001`,
              },
              geoPointValue: { geoPointValue: { latitude: 35.6812, longitude: 139.7671 } },
              zeroGeoPoint: { geoPointValue: { latitude: 0, longitude: 0 } },
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

async function verifyResetPreflightFailClosed(snapshotPath: string): Promise<void> {
  const addedTargets = [
    createWrite("logs/NEW-TARGET", {
      logKind: { stringValue: "tank" },
      tankId: { stringValue: "T-001" },
    }),
    createWrite("transactions/NEW-TARGET", {
      type: { stringValue: "return" },
      status: { stringValue: "pending" },
    }),
  ];
  await client.commit(addedTargets);
  await runSnapshotResetExpectFailure(snapshotPath, "snapshot取得後");
  await client.commit([
    { delete: client.fullDocumentName("logs/NEW-TARGET") },
    { delete: client.fullDocumentName("transactions/NEW-TARGET") },
  ]);

  await client.commit([createWrite("logs/UNKNOWN-KIND", {
    logKind: { stringValue: "future-kind" },
  })]);
  await runSnapshotResetExpectFailure(snapshotPath, "logKind");
  await client.commit([{ delete: client.fullDocumentName("logs/UNKNOWN-KIND") }]);

  await client.commit([createWrite("transactions/UNKNOWN-TYPE", {
    type: { stringValue: "future-type" },
  })]);
  await runSnapshotResetExpectFailure(snapshotPath, "typeを判定できない");
  await client.commit([{ delete: client.fullDocumentName("transactions/UNKNOWN-TYPE") }]);

  for (const subcollectionPath of [
    "tanks/T-001/notes/RESET-BLOCK",
    "logs/L-001/notes/RESET-BLOCK",
    "transactions/TX-001/notes/RESET-BLOCK",
    `${TRANSITION_MIGRATION_MARKER_PATH}/notes/RESET-BLOCK`,
  ]) {
    await client.commit([createWrite(subcollectionPath, {
      note: { stringValue: "reset must reject target subcollections" },
    })]);
    await runSnapshotResetExpectFailure(snapshotPath, "subcollection");
    await client.commit([{ delete: client.fullDocumentName(subcollectionPath) }]);
  }

  await client.commit([createWrite(TRANSITION_MIGRATION_MARKER_PATH, {
    status: { stringValue: "completed" },
  })]);
  await runSnapshotResetExpectFailure(snapshotPath, "marker");
  await client.commit([{ delete: client.fullDocumentName(TRANSITION_MIGRATION_MARKER_PATH) }]);
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

async function runSnapshotReset(
  snapshotPath: string,
  execute: boolean,
): Promise<{ output: Record<string, unknown>; stdout: string }> {
  const result = await runCli(
    "scripts/reset-transition-cutover-snapshot.mts",
    [
      ...commonArguments(),
      `--snapshot=${snapshotPath}`,
      ...(execute ? ["--execute", "--confirm=RESET_TRANSITION_PLAN_V1"] : []),
    ],
    true,
  );
  return { output: parseJsonOutput(result.stdout), stdout: result.stdout };
}

async function runSnapshotResetViaNpmSilent(
  snapshotPath: string,
): Promise<{ output: Record<string, unknown>; stdout: string }> {
  const result = await runChild(
    "npm",
    [
      "run",
      "--silent",
      "cutover:snapshot:reset",
      "--",
      ...commonArguments(),
      `--snapshot=${snapshotPath}`,
    ],
    true,
  );
  return { output: parseJsonOutput(result.stdout), stdout: result.stdout };
}

async function runSnapshotResetExpectFailure(
  snapshotPath: string,
  expectedMessage: string,
): Promise<void> {
  const result = await runCli(
    "scripts/reset-transition-cutover-snapshot.mts",
    [...commonArguments(), `--snapshot=${snapshotPath}`],
    false,
  );
  assert(result.stdout === "", "failed reset must not write stdout");
  assert(result.stderr.includes(expectedMessage), `reset failure: ${expectedMessage}`);
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

async function assertSourceStillPresent(expectedSourceCensusSha256: string): Promise<void> {
  const census = await readTransitionSourceCensus(client);
  assert(
    sourceCensusSha256(census) === expectedSourceCensusSha256,
    "reset dry-run preserves the full source census",
  );
  assert(census.markerDocument === null, "reset dry-run does not create marker");
  assert(
    census.documents.filter((document) => document.kind === "tank").length === 145,
    "reset dry-run preserves tanks",
  );
  assert(
    census.documents.filter((document) => document.kind === "tank_log").length === 38,
    "reset dry-run preserves tank logs",
  );
  assert(
    census.documents.filter((document) => document.kind === "transaction").length === 8,
    "reset dry-run preserves transactions",
  );
}

function assertSafeResetStdout(stdout: string, payload: TransitionSnapshotPayloadV1): void {
  const forbidden = [
    "T-001",
    "L-001",
    "TX-001",
    "テスト顧客",
    "倉庫",
    "typed-snapshot",
    "steel",
    payload.manifest.snapshotId,
    payload.manifest.keyId,
    tempDirectory,
  ];
  forbidden.forEach((value) => {
    assert(!stdout.includes(value), `reset stdout must not include ${value}`);
  });
  const output = parseJsonOutput(stdout);
  const allowedTopLevelKeys = new Set([
    "mode", "counts", "statusCounts", "writes", "requestBytes", "hashes",
    "commitTime", "commitResponse",
  ]);
  Object.keys(output).forEach((keyName) => {
    assert(allowedTopLevelKeys.has(keyName), `reset stdout top-level key: ${keyName}`);
  });
  const counts = objectValue(output.counts, "reset stdout counts");
  assertExactKeys(counts, ["tanks", "tankLogs", "transactions"], "reset stdout counts");
  Object.values(counts).forEach((value) => {
    assert(typeof value === "number", "reset stdout count value");
  });
  const statusCounts = objectValue(output.statusCounts, "reset stdout statusCounts");
  Object.values(statusCounts).forEach((value) => {
    assert(typeof value === "number", "reset stdout status count value");
  });
  const hashes = objectValue(output.hashes, "reset stdout hashes");
  assertExactKeys(
    hashes,
    ["snapshotPayloadSha256", "sourceCensusSha256", "resetPlanSha256"],
    "reset stdout hashes",
  );
  Object.values(hashes).forEach((value) => {
    assert(typeof value === "string" && /^[0-9a-f]{64}$/.test(value), "reset stdout hash value");
  });
}

function resetPlanHash(output: Record<string, unknown>): string {
  const hashes = objectValue(output.hashes, "reset hashes");
  const value = hashes.resetPlanSha256;
  if (typeof value !== "string") throw new Error("resetPlanSha256がありません");
  return value;
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label}がobjectではありません`);
  }
  return value as Record<string, unknown>;
}

function assertExactKeys(
  value: Record<string, unknown>,
  expectedKeys: string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${label} key allowlist`);
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

async function resetTimestampFromMarker(): Promise<string> {
  const result = await client.batchGet([TRANSITION_MIGRATION_MARKER_PATH]);
  const marker = result.get(client.fullDocumentName(TRANSITION_MIGRATION_MARKER_PATH));
  const value = marker?.fields?.resetAt;
  if (!value || !("timestampValue" in value)) throw new Error("marker resetAtがありません");
  return value.timestampValue;
}

async function assertRestored(payload: TransitionSnapshotPayloadV1): Promise<void> {
  const census = await readTransitionSourceCensus(client);
  assert(census.markerDocument === null, "restore deletes marker");
  const expected = new Map(payload.documents.map((document) => [document.name, document.fieldSha256]));
  assert(census.documents.length === payload.documents.length, "restored document count");
  census.documents.forEach((document) => {
    assert(expected.get(document.name) === document.fieldSha256, `field hash: ${document.name}`);
  });
  const payloadNegativeZero = tankMetadataValue(payload, "T-001", "negativeZero", "doubleValue");
  if (payloadNegativeZero !== undefined) {
    assert(payloadNegativeZero === 0, "payload retains normalized double zero after restore");
    const restoredTank = census.documents.find((document) => document.name.endsWith("/tanks/T-001"));
    const restoredNote = restoredTank?.fields.note;
    const restoredNegativeZero = restoredNote && "mapValue" in restoredNote
      ? restoredNote.mapValue.fields?.negativeZero
      : undefined;
    assert(
      restoredNegativeZero && "doubleValue" in restoredNegativeZero
        && restoredNegativeZero.doubleValue === 0,
      "restored Firestore document retains normalized double zero",
    );
  }
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

async function assertAtomicResetRaceRejected(
  label: string,
  introduceRace: () => Promise<void>,
  markerExpected = false,
): Promise<void> {
  const snapshotPath = join(tempDirectory, `snapshot-${label}.cutover.enc`);
  await runSnapshotCreate(snapshotPath);
  const envelope = await readEncryptedSnapshotFile(snapshotPath, { repositoryRoot: ROOT });
  const payload = decryptTransitionSnapshot(envelope, key, KEY_ID);
  const stalePlan = await planTransitionSnapshotReset({
    client,
    payload,
    snapshotPayloadSha256: envelope.payloadSha256,
    expectedProjectId: PROJECT_ID,
    expectedDatabaseId: DATABASE_ID,
    expectedDatabaseUid: DATABASE_UID,
    expectedMainCommit: MAIN_COMMIT,
    now: () => new Date("2026-07-13T03:00:00Z"),
  });
  assert(stalePlan.writes.length === 192, `${label}: reset write count`);

  await introduceRace();
  const beforeCommit = await readTransitionSourceCensus(client);
  let commitFailed = false;
  try {
    await client.commit(stalePlan.writes);
  } catch {
    commitFailed = true;
  }
  assert(commitFailed, `${label}: reset commit must fail`);
  const afterCommit = await readTransitionSourceCensus(client);
  assert(
    sourceCensusSha256(afterCommit) === sourceCensusSha256(beforeCommit),
    `${label}: failed reset must not partially apply any write`,
  );
  assert(
    Boolean(afterCommit.markerDocument) === markerExpected,
    `${label}: marker state must remain unchanged`,
  );
  assert(
    afterCommit.documents.filter((document) => document.kind === "tank_log").length === 38,
    `${label}: all target logs remain`,
  );
  assert(
    afterCommit.documents.filter((document) => document.kind === "transaction").length === 8,
    `${label}: all target transactions remain`,
  );
}

async function changeDocumentField(
  path: string,
  fieldName: string,
  value: FirestoreRestValue,
): Promise<void> {
  const fullName = client.fullDocumentName(path);
  const current = (await client.batchGet([path])).get(fullName);
  if (!current?.updateTime) throw new Error(`${path}がありません`);
  await client.commit([{
    update: {
      name: fullName,
      fields: {
        ...(current.fields ?? {}),
        [fieldName]: value,
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
  return runChild(process.execPath, ["--import", "tsx", script, ...args], expectSuccess);
}

function runChild(
  command: string,
  args: string[],
  expectSuccess: boolean,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
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
          `${command} ${expectSuccess ? "failed" : "unexpectedly succeeded"} (exit ${code})\n${stderr}\n${stdout}`,
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

function tankMetadataValue(
  payload: TransitionSnapshotPayloadV1,
  tankId: string,
  fieldName: string,
  unionKey: "doubleValue",
): unknown {
  const value = tankMetadata(payload, tankId, fieldName);
  return value && unionKey in value ? value[unionKey] : undefined;
}

function tankMetadata(
  payload: TransitionSnapshotPayloadV1,
  tankId: string,
  fieldName: string,
): FirestoreRestValue | undefined {
  const tank = payload.documents.find((document) => document.name.endsWith(`/tanks/${tankId}`));
  const note = tank?.fields.note;
  return note && "mapValue" in note ? note.mapValue.fields?.[fieldName] : undefined;
}

function assert(condition: unknown, label: string): asserts condition {
  if (!condition) throw new Error(`ASSERTION FAILED: ${label}`);
}
