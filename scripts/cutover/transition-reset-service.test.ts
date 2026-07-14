import { describe, expect, it, vi } from "vitest";
import {
  canonicalSha256,
  snapshotFieldSha256,
} from "./canonical-firestore-value";
import { FirestoreRestClient } from "./firestore-rest-client";
import type {
  FirestoreCommitResponse,
  FirestoreRestDocument,
  FirestoreRestValue,
  FirestoreWrite,
  TransitionSnapshotDocumentV1,
  TransitionSnapshotPayloadV1,
} from "./firestore-rest-types";
import {
  executeTransitionSnapshotReset,
  planTransitionSnapshotReset,
  statusCountsFromSnapshot,
} from "./transition-reset-service";

const PROJECT_ID = "demo-reset";
const DATABASE_ID = "(default)";
const DATABASE_PREFIX = `projects/${PROJECT_ID}/databases/${DATABASE_ID}`;
const DATABASE_UID = `emulator:${PROJECT_ID}:${DATABASE_ID}`;
const MAIN_COMMIT = "a".repeat(40);
const RESET_AT = "2026-07-13T03:00:00Z";

describe("transition atomic reset service", () => {
  it("snapshot updateTime付きfull overwrite/deleteとexists:false markerを一つのwrite列へ構成する", async () => {
    const payload = fixturePayload();
    const payloadSha256 = canonicalSha256(payload);
    const client = sourceClient(payload);
    const plan = await planTransitionSnapshotReset(resetOptions(client, payload));

    expect(plan.writes).toHaveLength(5);
    payload.documents.forEach((document, index) => {
      expect(plan.writes[index]?.currentDocument).toEqual({ updateTime: document.updateTime });
      if (document.kind === "tank") {
        expect(plan.writes[index]?.update?.fields.status).toEqual({ stringValue: "empty" });
        expect(plan.writes[index]?.update?.fields.location).toEqual({ stringValue: "倉庫" });
        expect(plan.writes[index]?.update?.fields.updatedAt).toEqual({ timestampValue: RESET_AT });
        expect(plan.writes[index]?.update?.fields.latestLogId).toBeUndefined();
      } else {
        expect(plan.writes[index]?.delete).toBe(document.name);
      }
    });
    const markerWrite = plan.writes.at(-1)!;
    expect(markerWrite.currentDocument).toEqual({ exists: false });
    expect(Object.keys(markerWrite.update?.fields ?? {}).sort()).toEqual([
      "completedAt",
      "databaseId",
      "databaseUid",
      "documentPathSha256",
      "keyId",
      "mainCommit",
      "migration",
      "projectId",
      "resetAt",
      "resetPlanSha256",
      "scriptVersion",
      "snapshotCreatedAt",
      "snapshotDocumentsSha256",
      "snapshotId",
      "snapshotPayloadSha256",
      "sourceCensusSha256",
      "sourceReadTime",
      "status",
      "statusCounts",
      "targetTankCount",
      "targetTankLogCount",
      "targetTransactionCount",
      "totalWriteCount",
    ].sort());
    expect(markerWrite.update?.fields.status).toEqual({ stringValue: "completed" });
    expect(markerWrite.update?.fields.snapshotPayloadSha256).toEqual({ stringValue: payloadSha256 });
    expect(markerWrite.update?.fields.sourceCensusSha256).toEqual({
      stringValue: payload.manifest.sourceCensusSha256,
    });
    expect(markerWrite.update?.fields.mainCommit).toEqual({ stringValue: MAIN_COMMIT });
    expect(plan.summary).toMatchObject({
      counts: { tanks: 2, tankLogs: 1, transactions: 1 },
      statusCounts: { filled: 1, lent: 1 },
      writes: 5,
      snapshotPayloadSha256: payloadSha256,
    });
    expect(client.runCollectionQuery).toHaveBeenCalledTimes(12);
    expect(client.listCollectionIds).toHaveBeenCalledTimes(10);
  });

  it("statusの未知値と欠落はraw値をstdout向け集計keyにしない", () => {
    const payload = fixturePayload([
      { stringValue: "future-secret-status" },
      undefined,
    ]);
    expect(statusCountsFromSnapshot(payload)).toEqual({ missing: 1, unknown: 1 });
  });

  it("service境界でpayloadのcanonical SHA不一致を読取前に拒否する", async () => {
    const payload = fixturePayload();
    const client = sourceClient(payload);
    await expect(planTransitionSnapshotReset({
      ...resetOptions(client, payload),
      snapshotPayloadSha256: "0".repeat(64),
    })).rejects.toThrow("payload SHA-256");
    expect(client.beginReadOnlyTransaction).not.toHaveBeenCalled();
  });

  it("snapshot後のfield/updateTime/inventory差分またはmarker存在をfail closedにする", async () => {
    const payload = fixturePayload();
    const driftedClient = sourceClient(payload, { driftTank: true });
    await expect(planTransitionSnapshotReset(resetOptions(driftedClient, payload)))
      .rejects.toThrow("snapshot取得後");

    const markedClient = sourceClient(payload, { markerExists: true });
    await expect(planTransitionSnapshotReset(resetOptions(markedClient, payload)))
      .rejects.toThrow("marker");
  });

  it("未知tank fieldを基本情報と推測せずresetを拒否する", async () => {
    const payload = fixturePayload([
      { stringValue: "lent" },
      { stringValue: "filled" },
    ], { futureOperationProjection: { stringValue: "secret" } });
    await expect(planTransitionSnapshotReset(resetOptions(sourceClient(payload), payload)))
      .rejects.toThrow("分類できない");
  });

  it("最終解放前はservice境界で本番reset executeを読取前に拒否する", async () => {
    const payload = fixturePayload();
    const client = new FirestoreRestClient({
      projectId: "production-reset",
      databaseId: DATABASE_ID,
      accessTokenProvider: async () => "unused",
    });
    client.verifyDatabaseUid = vi.fn(async () => undefined);
    await expect(executeTransitionSnapshotReset({
      ...resetOptions(client, {
        ...payload,
        manifest: { ...payload.manifest, projectId: "production-reset" },
      }),
      expectedProjectId: "production-reset",
    })).rejects.toThrow("本番reset execute");
    expect(client.verifyDatabaseUid).not.toHaveBeenCalled();
  });

  it("commitTime欠落は完全read-back後だけverifiedとして扱う", async () => {
    const payload = fixturePayload();
    const client = sourceClient(payload, {
      commitResponse: { writeResults: Array.from({ length: 5 }, () => ({})) },
    });
    const result = await executeTransitionSnapshotReset(resetOptions(client, payload));
    expect(result.commitResponse).toBe("verified_after_ambiguous_response");
    expect(result.commitTime).toBeNull();
  });

  it("commit通信例外でも適用済みならread-backでverifiedとする", async () => {
    const payload = fixturePayload();
    const client = sourceClient(payload, { throwAfterApply: true });
    const result = await executeTransitionSnapshotReset(resetOptions(client, payload));
    expect(result.commitResponse).toBe("verified_after_ambiguous_response");
    expect(result.commitTime).toBeNull();
  });

  it("commit通信例外後に遅延適用されても反復read-backでverifiedとする", async () => {
    const payload = fixturePayload();
    const client = sourceClient(payload, { delayedApplyAfterThrow: true });
    const result = await executeTransitionSnapshotReset(resetOptions(client, payload));
    expect(result.commitResponse).toBe("verified_after_ambiguous_response");
    expect(client.runCollectionQuery).toHaveBeenCalledTimes(24);
  });

  it("commit通信例外後に原状態でも未適用とは断定せず成功扱いにしない", async () => {
    const payload = fixturePayload();
    const client = sourceClient(payload, { throwWithoutApply: true });
    await expect(executeTransitionSnapshotReset(resetOptions(client, payload)))
      .rejects.toThrow("未適用とは断定できません");
  });

  it("plan後のphantom targetがcommitと競合した場合も成功扱いにしない", async () => {
    const payload = fixturePayload();
    const client = sourceClient(payload, { phantomAfterApply: true });
    await expect(executeTransitionSnapshotReset(resetOptions(client, payload)))
      .rejects.toThrow("対象tank logまたはtransactionが残っています");
  });

  it("dry-runとexecute時刻が異なっても同じ業務plan hashになる", async () => {
    const payload = fixturePayload();
    const first = await planTransitionSnapshotReset(resetOptions(sourceClient(payload), payload));
    const second = await planTransitionSnapshotReset({
      ...resetOptions(sourceClient(payload), payload),
      now: () => new Date("2026-07-13T04:00:00Z"),
    });
    expect(first.resetAt).not.toBe(second.resetAt);
    expect(first.summary.resetPlanSha256).toBe(second.summary.resetPlanSha256);
  });
});

function resetOptions(client: FirestoreRestClient, payload: TransitionSnapshotPayloadV1) {
  return {
    client,
    payload,
    snapshotPayloadSha256: canonicalSha256(payload),
    expectedProjectId: client.projectId,
    expectedDatabaseId: DATABASE_ID,
    expectedDatabaseUid: client.emulatorHost ? DATABASE_UID : "production-uid",
    expectedMainCommit: MAIN_COMMIT,
    now: () => new Date(RESET_AT),
    ambiguousReadbackDelaysMs: [0, 0],
  };
}

function fixturePayload(
  statuses: Array<FirestoreRestValue | undefined> = [
    { stringValue: "lent" },
    { stringValue: "filled" },
  ],
  extraTankFields: Record<string, FirestoreRestValue> = {},
): TransitionSnapshotPayloadV1 {
  const documents = [
    snapshotDocument("tank_log", "logs/L-001", {
      logKind: { stringValue: "tank" },
      tankId: { stringValue: "T-001" },
    }, "2026-07-13T00:00:03Z"),
    snapshotDocument("tank", "tanks/T-001", {
      ...(statuses[0] ? { status: statuses[0] } : {}),
      location: { stringValue: "A社" },
      type: { stringValue: "steel" },
      latestLogId: { stringValue: "L-001" },
      ...extraTankFields,
    }, "2026-07-13T00:00:01Z"),
    snapshotDocument("tank", "tanks/T-002", {
      ...(statuses[1] ? { status: statuses[1] } : {}),
      location: { stringValue: "倉庫" },
      type: { stringValue: "aluminum" },
    }, "2026-07-13T00:00:02Z"),
    snapshotDocument("transaction", "transactions/TX-001", {
      type: { stringValue: "return" },
      status: { stringValue: "pending" },
    }, "2026-07-13T00:00:04Z"),
  ];
  const inventory = {
    totalLogs: 1,
    preservedNonTankLogs: 0,
    unknownLogs: 0 as const,
    totalTransactions: 1,
    preservedTransactions: 0,
    unknownTransactions: 0 as const,
  };
  return {
    manifest: {
      version: 1,
      scope: "transitionPlanRequiredV1",
      snapshotId: "snapshot-reset-test",
      createdAt: "2026-07-13T00:00:10Z",
      readTime: "2026-07-13T00:00:05Z",
      projectId: PROJECT_ID,
      databaseId: DATABASE_ID,
      databaseUid: DATABASE_UID,
      mainCommit: MAIN_COMMIT,
      keyId: "test-key",
      migrationMarkerPath: "migrationMarkers/transitionPlanRequiredV1",
      counts: { tanks: 2, tankLogs: 1, transactions: 1, restoreWrites: 5 },
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
      subcollectionsChecked: 5,
    },
    documents,
  };
}

function sourceClient(
  payload: TransitionSnapshotPayloadV1,
  behavior: {
    driftTank?: boolean;
    markerExists?: boolean;
    commitResponse?: FirestoreCommitResponse;
    throwAfterApply?: boolean;
    throwWithoutApply?: boolean;
    delayedApplyAfterThrow?: boolean;
    phantomAfterApply?: boolean;
  } = {},
): FirestoreRestClient {
  const client = new FirestoreRestClient({
    projectId: PROJECT_ID,
    databaseId: DATABASE_ID,
    emulatorHost: "127.0.0.1:8089",
  });
  const documents = new Map<string, FirestoreRestDocument>();
  payload.documents.forEach((document) => {
    documents.set(document.name, {
      name: document.name,
      fields: document.fields,
      createTime: document.createTime,
      updateTime: document.updateTime,
    });
  });
  if (behavior.driftTank) {
    const name = client.fullDocumentName("tanks/T-001");
    const tank = documents.get(name)!;
    documents.set(name, {
      ...tank,
      fields: { ...(tank.fields ?? {}), note: { stringValue: "drift" } },
      updateTime: "2026-07-13T00:01:00Z",
    });
  }
  if (behavior.markerExists) {
    const name = client.fullDocumentName("migrationMarkers/transitionPlanRequiredV1");
    documents.set(name, restDocument(name, { status: { stringValue: "completed" } }));
  }

  let queryCallCount = 0;
  let pendingWrites: FirestoreWrite[] | null = null;
  client.verifyDatabaseUid = vi.fn(async () => undefined);
  client.beginReadOnlyTransaction = vi.fn(async () => "read-only-token");
  client.rollback = vi.fn(async () => undefined);
  client.listCollectionIds = vi.fn(async () => []);
  client.runCollectionQuery = vi.fn(async (collectionId: string) => {
    queryCallCount += 1;
    if (pendingWrites && queryCallCount >= 17) {
      applyWrites(documents, pendingWrites);
      pendingWrites = null;
    }
    return {
      documents: [...documents.values()].filter((document) => (
        document.name.includes(`/documents/${collectionId}/`)
        && document.name.split("/documents/")[1]?.split("/").length === 2
      )),
      readTime: "2026-07-13T00:02:00Z",
    };
  });
  client.commit = vi.fn(async (writes: FirestoreWrite[]) => {
    if (behavior.delayedApplyAfterThrow) {
      pendingWrites = writes;
      throw new Error("connection lost");
    }
    if (!behavior.throwWithoutApply) applyWrites(documents, writes);
    if (behavior.phantomAfterApply) {
      const name = client.fullDocumentName("logs/PHANTOM");
      documents.set(name, restDocument(name, {
        logKind: { stringValue: "tank" },
        tankId: { stringValue: "T-001" },
      }));
    }
    if (behavior.throwAfterApply || behavior.throwWithoutApply) {
      throw new Error("connection lost");
    }
    return behavior.commitResponse ?? {
      commitTime: "2026-07-13T03:00:01Z",
      writeResults: writes.map(() => ({})),
    };
  });
  return client;
}

function applyWrites(documents: Map<string, FirestoreRestDocument>, writes: FirestoreWrite[]): void {
  writes.forEach((write, index) => {
    if (write.delete) {
      documents.delete(write.delete);
      return;
    }
    if (write.update) {
      documents.set(write.update.name, {
        name: write.update.name,
        fields: write.update.fields,
        createTime: documents.get(write.update.name)?.createTime ?? "2026-07-13T03:00:00Z",
        updateTime: `2026-07-13T03:00:${String(index + 1).padStart(2, "0")}Z`,
      });
    }
  });
}

function snapshotDocument(
  kind: TransitionSnapshotDocumentV1["kind"],
  path: string,
  fields: Record<string, FirestoreRestValue>,
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

function restDocument(
  name: string,
  fields: Record<string, FirestoreRestValue>,
): FirestoreRestDocument {
  return {
    name,
    fields,
    createTime: "2026-07-13T00:00:00Z",
    updateTime: "2026-07-13T00:00:01Z",
  };
}
