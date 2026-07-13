import { describe, expect, it, vi } from "vitest";
import { canonicalSha256, snapshotFieldSha256 } from "./canonical-firestore-value";
import { FirestoreRestClient } from "./firestore-rest-client";
import type {
  FirestoreRestDocument,
  TransitionSnapshotDocumentV1,
  TransitionSnapshotPayloadV1,
  TransitionSourceCensus,
} from "./firestore-rest-types";
import {
  MAX_CUTOVER_COMMIT_BYTES,
  MAX_CUTOVER_COMMIT_WRITES,
  assertCommitBounds,
  assertRestoreIdentity,
  buildRestoreWrites,
  executeTransitionSnapshotRestore,
  resetProjectionFieldsFromSnapshot,
} from "./transition-snapshot-service";

const PROJECT_ID = "demo-cutover";
const DATABASE_ID = "(default)";
const DATABASE_PREFIX = `projects/${PROJECT_ID}/databases/${DATABASE_ID}`;

describe("transition snapshot restore core", () => {
  it("tank overwrite、log/transaction再作成、marker削除を一つのwrite列へ構成する", () => {
    const payload = fixturePayload();
    const currentTank = snapshotDocument("tank", "tanks/T-001", {
      type: { stringValue: "steel" },
      status: { stringValue: "empty" },
      location: { stringValue: "倉庫" },
      updatedAt: { timestampValue: "2026-07-13T01:00:00Z" },
    }, "2026-07-13T01:00:01Z");
    const marker: FirestoreRestDocument = {
      name: `${DATABASE_PREFIX}/documents/migrationMarkers/transitionPlanRequiredV1`,
      fields: { status: { stringValue: "completed" } },
      createTime: "2026-07-13T01:00:00Z",
      updateTime: "2026-07-13T01:00:02Z",
    };
    const current: TransitionSourceCensus = {
      documents: [currentTank],
      readTime: "2026-07-13T01:00:03Z",
      inventory: {
        totalLogs: 0,
        preservedNonTankLogs: 0,
        unknownLogs: 0,
        totalTransactions: 0,
        preservedTransactions: 0,
        unknownTransactions: 0,
      },
      markerDocument: marker,
    };
    const client = new FirestoreRestClient({
      projectId: PROJECT_ID,
      databaseId: DATABASE_ID,
      emulatorHost: "127.0.0.1:8089",
    });

    expect(buildRestoreWrites(payload, current, client)).toEqual([
      {
        update: {
          name: `${DATABASE_PREFIX}/documents/logs/L-001`,
          fields: payload.documents[0].fields,
        },
        currentDocument: { exists: false },
      },
      {
        update: {
          name: `${DATABASE_PREFIX}/documents/tanks/T-001`,
          fields: payload.documents[1].fields,
        },
        currentDocument: { updateTime: currentTank.updateTime },
      },
      {
        delete: marker.name,
        currentDocument: { updateTime: marker.updateTime },
      },
    ]);
  });

  it("reset projectionは基本情報だけを保持して操作projectionを初期化する", () => {
    const tank = fixturePayload().documents.find((document) => document.kind === "tank")!;
    expect(resetProjectionFieldsFromSnapshot(tank, "2026-07-13T01:00:00Z")).toEqual({
      type: { stringValue: "steel" },
      status: { stringValue: "empty" },
      location: { stringValue: "倉庫" },
      updatedAt: { timestampValue: "2026-07-13T01:00:00Z" },
    });
  });

  it("write数とrequest byteの内部上限をfail closedにする", () => {
    expect(() => assertCommitBounds(MAX_CUTOVER_COMMIT_WRITES, MAX_CUTOVER_COMMIT_BYTES))
      .not.toThrow();
    expect(() => assertCommitBounds(MAX_CUTOVER_COMMIT_WRITES + 1, 1)).toThrow("writes");
    expect(() => assertCommitBounds(1, MAX_CUTOVER_COMMIT_BYTES + 1)).toThrow("bytes");
  });

  it("project、database、UID、main commitの不一致を拒否する", () => {
    const payload = fixturePayload();
    const client = new FirestoreRestClient({
      projectId: PROJECT_ID,
      databaseId: DATABASE_ID,
      emulatorHost: "127.0.0.1:8089",
    });
    const valid = {
      client,
      payload,
      snapshotPayloadSha256: "f".repeat(64),
      expectedProjectId: PROJECT_ID,
      expectedDatabaseId: DATABASE_ID,
      expectedDatabaseUid: `emulator:${PROJECT_ID}:${DATABASE_ID}`,
      expectedMainCommit: "a".repeat(40),
    };
    expect(() => assertRestoreIdentity(payload, { ...valid, expectedProjectId: "other" }))
      .toThrow("project ID");
    expect(() => assertRestoreIdentity(payload, { ...valid, expectedDatabaseId: "other" }))
      .toThrow("database ID");
    expect(() => assertRestoreIdentity(payload, { ...valid, expectedDatabaseUid: "other" }))
      .toThrow("database UID");
    expect(() => assertRestoreIdentity(payload, { ...valid, expectedMainCommit: "b".repeat(40) }))
      .toThrow("main commit");
    expect(() => assertRestoreIdentity(payload, valid)).not.toThrow();
  });

  it("freeze/runbook実装前はservice境界で本番restore executeを拒否する", async () => {
    const productionClient = new FirestoreRestClient({
      projectId: "okmarine-tankrental",
      databaseId: DATABASE_ID,
      accessTokenProvider: async () => "unused-test-token",
    });
    await expect(executeTransitionSnapshotRestore({
      client: productionClient,
      payload: fixturePayload(),
      snapshotPayloadSha256: "f".repeat(64),
      expectedProjectId: "okmarine-tankrental",
      expectedDatabaseId: DATABASE_ID,
      expectedDatabaseUid: "production-database-uid",
      expectedMainCommit: "a".repeat(40),
    })).rejects.toThrow("本番restore execute");
  });

  it.each([
    ["commitTime欠落", { writeResults: [{}, {}, {}] }],
    ["writeResults件数不一致", { commitTime: "2026-07-13T01:00:10Z", writeResults: [] }],
  ])("%sの曖昧応答は完全read-back後にだけ成功とする", async (_label, response) => {
    const payload = fixturePayload();
    const client = ambiguousCommitClient(payload, response);
    const result = await executeTransitionSnapshotRestore({
      client,
      payload,
      snapshotPayloadSha256: "f".repeat(64),
      expectedProjectId: PROJECT_ID,
      expectedDatabaseId: DATABASE_ID,
      expectedDatabaseUid: `emulator:${PROJECT_ID}:${DATABASE_ID}`,
      expectedMainCommit: "a".repeat(40),
    });
    expect(result.commitResponse).toBe("verified_after_ambiguous_response");
    expect(client.runCollectionQuery).toHaveBeenCalledTimes(12);
  });
});

function fixturePayload(): TransitionSnapshotPayloadV1 {
  const log = snapshotDocument("tank_log", "logs/L-001", {
    logKind: { stringValue: "tank" },
    tankId: { stringValue: "T-001" },
  }, "2026-07-13T00:00:02Z");
  const tank = snapshotDocument("tank", "tanks/T-001", {
    type: { stringValue: "steel" },
    status: { stringValue: "lent" },
    location: { stringValue: "A社" },
    latestLogId: { stringValue: "L-001" },
  }, "2026-07-13T00:00:01Z");
  const documents = [log, tank];
  const inventory = {
    totalLogs: 1,
    preservedNonTankLogs: 0,
    unknownLogs: 0 as const,
    totalTransactions: 0,
    preservedTransactions: 0,
    unknownTransactions: 0 as const,
  };
  return {
    manifest: {
      version: 1,
      scope: "transitionPlanRequiredV1",
      snapshotId: "snapshot-service-test",
      createdAt: "2026-07-13T00:00:10Z",
      readTime: "2026-07-13T00:00:03Z",
      projectId: PROJECT_ID,
      databaseId: DATABASE_ID,
      databaseUid: `emulator:${PROJECT_ID}:${DATABASE_ID}`,
      mainCommit: "a".repeat(40),
      keyId: "key-1",
      migrationMarkerPath: "migrationMarkers/transitionPlanRequiredV1",
      counts: { tanks: 1, tankLogs: 1, transactions: 0, restoreWrites: 3 },
      inventory,
      documentPathSha256: canonicalSha256(documents.map((document) => document.name)),
      sourceCensusSha256: canonicalSha256({
        documents: documents.map((document) => ({
          name: document.name,
          updateTime: document.updateTime,
          fieldSha256: document.fieldSha256,
        })),
        inventory,
        marker: null,
      }),
      snapshotDocumentsSha256: canonicalSha256(documents),
      subcollectionsChecked: 3,
    },
    documents,
  };
}

function ambiguousCommitClient(
  payload: TransitionSnapshotPayloadV1,
  commitResponse: { commitTime?: string; writeResults?: Array<Record<string, never>> },
): FirestoreRestClient {
  const client = new FirestoreRestClient({
    projectId: PROJECT_ID,
    databaseId: DATABASE_ID,
    emulatorHost: "127.0.0.1:8089",
  });
  const resetAt = "2026-07-13T01:00:00Z";
  const tank = payload.documents.find((document) => document.kind === "tank")!;
  const marker: FirestoreRestDocument = {
    name: `${DATABASE_PREFIX}/documents/migrationMarkers/transitionPlanRequiredV1`,
    fields: {
      status: { stringValue: "completed" },
      snapshotId: { stringValue: payload.manifest.snapshotId },
      snapshotPayloadSha256: { stringValue: "f".repeat(64) },
      snapshotDocumentsSha256: { stringValue: payload.manifest.snapshotDocumentsSha256 },
      sourceCensusSha256: { stringValue: payload.manifest.sourceCensusSha256 },
      resetAt: { timestampValue: resetAt },
    },
    createTime: resetAt,
    updateTime: "2026-07-13T01:00:01Z",
  };
  let restored = false;
  client.verifyDatabaseUid = vi.fn(async () => undefined);
  client.beginReadOnlyTransaction = vi.fn(async () => "read-only-transaction");
  client.rollback = vi.fn(async () => undefined);
  client.listCollectionIds = vi.fn(async () => []);
  client.runCollectionQuery = vi.fn(async (collectionId: string) => {
    const documents = restored
      ? payload.documents
          .filter((document) => document.name.includes(`/documents/${collectionId}/`))
          .map((document) => ({
            name: document.name,
            fields: document.fields,
            createTime: document.createTime,
            updateTime: document.updateTime,
          }))
      : collectionId === "tanks"
        ? [{
            name: tank.name,
            fields: resetProjectionFieldsFromSnapshot(tank, resetAt),
            createTime: tank.createTime,
            updateTime: "2026-07-13T01:00:02Z",
          }]
        : collectionId === "migrationMarkers"
          ? [marker]
          : [];
    return { documents, readTime: "2026-07-13T01:00:03Z" };
  });
  client.commit = vi.fn(async () => {
    restored = true;
    return commitResponse;
  });
  return client;
}

function snapshotDocument(
  kind: TransitionSnapshotDocumentV1["kind"],
  path: string,
  fields: TransitionSnapshotDocumentV1["fields"],
  updateTime: string,
): TransitionSnapshotDocumentV1 {
  const name = `${DATABASE_PREFIX}/documents/${path}`;
  return {
    kind,
    name,
    fields,
    createTime: "2026-07-13T00:00:00Z",
    updateTime,
    fieldSha256: snapshotFieldSha256(name, fields),
  };
}
