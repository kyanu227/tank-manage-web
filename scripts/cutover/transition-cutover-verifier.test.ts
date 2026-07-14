import { describe, expect, it, vi } from "vitest";
import {
  canonicalSha256,
  compareCanonicalStrings,
  snapshotFieldSha256,
} from "./canonical-firestore-value";
import { FirestoreRestClient } from "./firestore-rest-client";
import type {
  FirestoreRestDocument,
  FirestoreRestValue,
  TransitionSnapshotDocumentV1,
  TransitionSnapshotPayloadV1,
  TransitionSourceCensus,
} from "./firestore-rest-types";
import { createTransitionResetContract } from "./transition-reset-contract";
import {
  TRANSITION_MIGRATION_MARKER_PATH,
  resetProjectionFieldsFromSnapshot,
} from "./transition-snapshot-service";
import { verifyTransitionCutoverState } from "./transition-cutover-verifier";

const PROJECT_ID = "demo-verifier";
const DATABASE_ID = "(default)";
const DATABASE_PREFIX = `projects/${PROJECT_ID}/databases/${DATABASE_ID}`;
const DATABASE_UID = `emulator:${PROJECT_ID}:${DATABASE_ID}`;
const MAIN_COMMIT = "a".repeat(40);
const RESET_AT = "2026-07-14T00:00:00Z";

describe("transition cutover read-only verifier", () => {
  it("完全一致するreset状態を3回観測した場合だけappliedとする", async () => {
    const payload = fixturePayload();
    const payloadSha256 = canonicalSha256(payload);
    const census = resetCensus(payload, payloadSha256);
    const client = clientForCensuses([census, census, census]);

    const result = await verifyTransitionCutoverState({
      ...verificationOptions(client, payload),
      observationDelaysMs: [0, 0],
    });

    expect(result).toMatchObject({
      status: "reset_applied",
      applied: true,
      safeToRetry: false,
      observations: 3,
    });
    expect(result.stableStateSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(client.verifyDatabaseUid).toHaveBeenCalledWith(DATABASE_UID);
    expect(client.beginReadOnlyTransaction).toHaveBeenCalledTimes(3);
    expect(client.commit).not.toHaveBeenCalled();
  });

  it("snapshot時のsourceが安定して見えても再実行可能とは判定しない", async () => {
    const payload = fixturePayload();
    const client = clientForCensuses([
      sourceCensus(payload),
      sourceCensus(payload),
      sourceCensus(payload),
    ]);

    const result = await verify(client, payload);

    expect(result).toMatchObject({
      status: "source_or_restored_observed",
      applied: false,
      safeToRetry: false,
      observations: 3,
    });
  });

  it("fieldが完全復元されupdateTimeだけが変わった状態もsource/restoredとして扱う", async () => {
    const payload = fixturePayload();
    const census = restoredCensus(payload, "2026-07-14T01:00:00Z");
    const client = clientForCensuses([census, census, census]);

    const result = await verify(client, payload);

    expect(result.status).toBe("source_or_restored_observed");
    expect(result.applied).toBe(false);
    expect(result.safeToRetry).toBe(false);
  });

  it("同じ分類でも3回の途中でcensusが変わればunknownにする", async () => {
    const payload = fixturePayload();
    const source = sourceCensus(payload);
    const restored = restoredCensus(payload, "2026-07-14T01:00:00Z");
    const client = clientForCensuses([source, restored, restored]);

    const result = await verify(client, payload);

    expect(result).toEqual({
      status: "unknown",
      applied: false,
      safeToRetry: false,
      observations: 3,
      stableStateSha256: null,
    });
  });

  it("reset markerまたはtank全fieldが契約と異なればappliedにしない", async () => {
    const payload = fixturePayload();
    const payloadSha256 = canonicalSha256(payload);
    const reset = resetCensus(payload, payloadSha256);
    const marker = reset.markerDocument!;
    const tampered: TransitionSourceCensus = {
      ...reset,
      markerDocument: {
        ...marker,
        fields: {
          ...(marker.fields ?? {}),
          snapshotId: { stringValue: "different-snapshot" },
        },
      },
    };
    const client = clientForCensuses([tampered, tampered, tampered]);

    const result = await verify(client, payload);

    expect(result.status).toBe("unknown");
    expect(result.applied).toBe(false);
    expect(result.stableStateSha256).toMatch(/^[0-9a-f]{64}$/);

    const resetTank = reset.documents[0]!;
    const tamperedTankFields = {
      ...resetTank.fields,
      status: { stringValue: "filled" } satisfies FirestoreRestValue,
    };
    const tankTampered: TransitionSourceCensus = {
      ...reset,
      documents: [{
        ...resetTank,
        fields: tamperedTankFields,
        fieldSha256: snapshotFieldSha256(resetTank.name, tamperedTankFields),
      }],
    };
    const tankClient = clientForCensuses([tankTampered, tankTampered, tankTampered]);
    expect((await verify(tankClient, payload)).status).toBe("unknown");
  });

  it("対象配下のsubcollectionが一つでもあればunknownにする", async () => {
    const payload = fixturePayload();
    const reset = resetCensus(payload, canonicalSha256(payload));
    const client = clientForCensuses([reset, reset, reset], {
      subcollectionPaths: new Set(["tanks/T-001"]),
    });

    const result = await verify(client, payload);

    expect(result.status).toBe("unknown");
    expect(result.applied).toBe(false);
  });

  it("一度でもreadに失敗した場合は後続が完全resetでもunknownにする", async () => {
    const payload = fixturePayload();
    const reset = resetCensus(payload, canonicalSha256(payload));
    const client = clientForCensuses([reset, reset, reset], {
      failedObservationIndexes: new Set([0]),
    });

    const result = await verify(client, payload);

    expect(result.status).toBe("unknown");
    expect(result.stableStateSha256).toBeNull();
    expect(client.beginReadOnlyTransaction).toHaveBeenCalledTimes(3);
  });

  it("payload SHAまたは実行先identityの不一致を観測前に拒否する", async () => {
    const payload = fixturePayload();
    const client = clientForCensuses([sourceCensus(payload)]);
    await expect(verifyTransitionCutoverState({
      ...verificationOptions(client, payload),
      snapshotPayloadSha256: "0".repeat(64),
      observationDelaysMs: [0, 0],
    })).rejects.toThrow("payloadと一致");
    expect(client.beginReadOnlyTransaction).not.toHaveBeenCalled();

    const wrongClient = new FirestoreRestClient({
      projectId: "demo-different",
      databaseId: DATABASE_ID,
      emulatorHost: "127.0.0.1:8089",
    });
    await expect(verifyTransitionCutoverState({
      ...verificationOptions(wrongClient, payload),
      observationDelaysMs: [0, 0],
    })).rejects.toThrow("project ID");

    await expect(verifyTransitionCutoverState({
      ...verificationOptions(client, payload),
      expectedDatabaseUid: "different-database-uid",
      observationDelaysMs: [0, 0],
    })).rejects.toThrow("database UID");

    await expect(verifyTransitionCutoverState({
      ...verificationOptions(client, payload),
      expectedMainCommit: "b".repeat(40),
      observationDelaysMs: [0, 0],
    })).rejects.toThrow("main commit");
  });

  it("3回観測の待機時間は2つの有限な非負値だけを許可する", async () => {
    const payload = fixturePayload();
    const client = clientForCensuses([sourceCensus(payload)]);
    await expect(verifyTransitionCutoverState({
      ...verificationOptions(client, payload),
      observationDelaysMs: [0],
    })).rejects.toThrow("待機時間を2つ");
    await expect(verifyTransitionCutoverState({
      ...verificationOptions(client, payload),
      observationDelaysMs: [0, Number.NaN],
    })).rejects.toThrow("待機時間を2つ");
  });
});

function verify(client: FirestoreRestClient, payload: TransitionSnapshotPayloadV1) {
  return verifyTransitionCutoverState({
    ...verificationOptions(client, payload),
    observationDelaysMs: [0, 0],
  });
}

function verificationOptions(
  client: FirestoreRestClient,
  payload: TransitionSnapshotPayloadV1,
) {
  return {
    client,
    payload,
    snapshotPayloadSha256: canonicalSha256(payload),
    expectedProjectId: PROJECT_ID,
    expectedDatabaseId: DATABASE_ID,
    expectedDatabaseUid: DATABASE_UID,
    expectedMainCommit: MAIN_COMMIT,
  };
}

function fixturePayload(): TransitionSnapshotPayloadV1 {
  const documents = [
    snapshotDocument("tank_log", "logs/L-001", {
      logKind: { stringValue: "tank" },
      tankId: { stringValue: "T-001" },
    }, "2026-07-13T00:00:02Z"),
    snapshotDocument("tank", "tanks/T-001", {
      status: { stringValue: "lent" },
      location: { stringValue: "A社" },
      tankNumber: { stringValue: "T-001" },
      latestLogId: { stringValue: "L-001" },
    }, "2026-07-13T00:00:01Z"),
    snapshotDocument("transaction", "transactions/TX-001", {
      type: { stringValue: "return" },
      status: { stringValue: "pending" },
    }, "2026-07-13T00:00:03Z"),
  ].sort((left, right) => compareCanonicalStrings(left.name, right.name));
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
      snapshotId: "snapshot-verifier-001",
      createdAt: "2026-07-13T00:00:10Z",
      readTime: "2026-07-13T00:00:11Z",
      projectId: PROJECT_ID,
      databaseId: DATABASE_ID,
      databaseUid: DATABASE_UID,
      mainCommit: MAIN_COMMIT,
      keyId: "verifier-key",
      migrationMarkerPath: TRANSITION_MIGRATION_MARKER_PATH,
      counts: { tanks: 1, tankLogs: 1, transactions: 1, restoreWrites: 4 },
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
      subcollectionsChecked: 4,
    },
    documents,
  };
}

function snapshotDocument(
  kind: TransitionSnapshotDocumentV1["kind"],
  relativePath: string,
  fields: Record<string, FirestoreRestValue>,
  updateTime: string,
): TransitionSnapshotDocumentV1 {
  const name = `${DATABASE_PREFIX}/documents/${relativePath}`;
  return {
    kind,
    name,
    fields,
    createTime: "2026-07-12T00:00:00Z",
    updateTime,
    fieldSha256: snapshotFieldSha256(name, fields),
  };
}

function sourceCensus(payload: TransitionSnapshotPayloadV1): TransitionSourceCensus {
  return {
    documents: payload.documents,
    readTime: payload.manifest.readTime,
    inventory: payload.manifest.inventory,
    markerDocument: null,
  };
}

function restoredCensus(
  payload: TransitionSnapshotPayloadV1,
  updateTime: string,
): TransitionSourceCensus {
  return {
    ...sourceCensus(payload),
    documents: payload.documents.map((document, index) => ({
      ...document,
      updateTime: new Date(Date.parse(updateTime) + index * 1_000).toISOString(),
    })),
  };
}

function resetCensus(
  payload: TransitionSnapshotPayloadV1,
  payloadSha256: string,
): TransitionSourceCensus {
  const documents = payload.documents
    .filter((document) => document.kind === "tank")
    .map((document) => {
      const fields = resetProjectionFieldsFromSnapshot(document, RESET_AT);
      return {
        ...document,
        fields,
        updateTime: "2026-07-14T00:00:01Z",
        fieldSha256: snapshotFieldSha256(document.name, fields),
      };
    });
  return {
    documents,
    readTime: "2026-07-14T00:00:02Z",
    inventory: {
      totalLogs: 0,
      preservedNonTankLogs: 0,
      unknownLogs: 0,
      totalTransactions: 0,
      preservedTransactions: 0,
      unknownTransactions: 0,
    },
    markerDocument: {
      name: `${DATABASE_PREFIX}/documents/${TRANSITION_MIGRATION_MARKER_PATH}`,
      fields: createTransitionResetContract(payload, payloadSha256, RESET_AT).markerFields,
      createTime: "2026-07-14T00:00:01Z",
      updateTime: "2026-07-14T00:00:01Z",
    },
  };
}

function clientForCensuses(
  censuses: TransitionSourceCensus[],
  options: {
    subcollectionPaths?: Set<string>;
    failedObservationIndexes?: Set<number>;
  } = {},
): FirestoreRestClient {
  const client = new FirestoreRestClient({
    projectId: PROJECT_ID,
    databaseId: DATABASE_ID,
    emulatorHost: "127.0.0.1:8089",
  });
  let observationIndex = 0;
  client.verifyDatabaseUid = vi.fn(async () => undefined);
  client.beginReadOnlyTransaction = vi.fn(async () => {
    const currentIndex = observationIndex;
    observationIndex += 1;
    if (options.failedObservationIndexes?.has(currentIndex)) {
      throw new Error("simulated read failure");
    }
    return `observation-${currentIndex}`;
  });
  client.runCollectionQuery = vi.fn(async (collectionId, transaction) => {
    const index = Number(transaction.split("-").at(-1));
    const census = censuses[index] ?? censuses.at(-1);
    if (!census) throw new Error("test censusがありません");
    return {
      documents: rawDocumentsForCollection(census, collectionId),
      readTime: census.readTime,
    };
  });
  client.rollback = vi.fn(async () => undefined);
  client.listCollectionIds = vi.fn(async (path) => (
    options.subcollectionPaths?.has(path) ? ["notes"] : []
  ));
  client.commit = vi.fn(async () => ({ commitTime: "unexpected" }));
  return client;
}

function rawDocumentsForCollection(
  census: TransitionSourceCensus,
  collectionId: string,
): FirestoreRestDocument[] {
  const toRawDocument = (document: TransitionSnapshotDocumentV1): FirestoreRestDocument => ({
    name: document.name,
    fields: document.fields,
    createTime: document.createTime,
    updateTime: document.updateTime,
  });
  if (collectionId === "tanks") {
    return census.documents
      .filter((document) => document.kind === "tank")
      .map(toRawDocument);
  }
  if (collectionId === "logs") {
    return census.documents
      .filter((document) => document.kind === "tank_log")
      .map(toRawDocument);
  }
  if (collectionId === "transactions") {
    return census.documents
      .filter((document) => document.kind === "transaction")
      .map(toRawDocument);
  }
  if (collectionId === "migrationMarkers") {
    return census.markerDocument ? [census.markerDocument] : [];
  }
  throw new Error(`unexpected collection: ${collectionId}`);
}
