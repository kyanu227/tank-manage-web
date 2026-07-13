import { describe, expect, it } from "vitest";
import {
  canonicalSha256,
  canonicalStringify,
  normalizeFirestoreDocument,
  normalizeFirestoreValue,
  snapshotFieldSha256,
  validateTransitionSnapshotPayload,
} from "./canonical-firestore-value";
import type {
  TransitionSnapshotDocumentV1,
  TransitionSnapshotPayloadV1,
} from "./firestore-rest-types";

const DATABASE_PREFIX = "projects/demo-cutover/databases/(default)";

describe("Firestore REST Value canonicalization", () => {
  it("全Firestore Value型を型情報を失わずcanonical化する", () => {
    const fields = {
      null: { nullValue: null },
      bool: { booleanValue: true },
      integer: { integerValue: "9223372036854775807" },
      double: { doubleValue: 1 },
      negativeZero: { doubleValue: -0 },
      nan: { doubleValue: "NaN" },
      timestamp: { timestampValue: "2026-07-13T00:00:00.123456789Z" },
      string: { stringValue: "日本語" },
      bytes: { bytesValue: Buffer.from("typed-bytes").toString("base64") },
      reference: { referenceValue: `${DATABASE_PREFIX}/documents/customers/customer-1` },
      geo: { geoPointValue: { latitude: 35.6812, longitude: 139.7671 } },
      array: { arrayValue: { values: [{ integerValue: "1" }, { stringValue: "two" }] } },
      map: { mapValue: { fields: { z: { booleanValue: false }, a: { nullValue: null } } } },
    };
    const normalized = normalizeFirestoreDocument({
      name: `${DATABASE_PREFIX}/documents/tanks/T-001`,
      fields,
      createTime: "2026-07-13T00:00:00Z",
      updateTime: "2026-07-13T00:00:01.000001Z",
    }, DATABASE_PREFIX);

    expect(normalized.fields.integer).toEqual({ integerValue: "9223372036854775807" });
    expect(normalized.fields.double).toEqual({ doubleValue: 1 });
    expect(normalized.fields.negativeZero).toEqual({ doubleValue: 0 });
    expect(normalized.fields.map).toEqual({
      mapValue: { fields: { a: { nullValue: null }, z: { booleanValue: false } } },
    });
    expect(canonicalStringify(normalized.fields.negativeZero)).toContain("0");
  });

  it("integerとdoubleの型差を保持し、Firestoreと同様に-0.0を0.0へ正規化する", () => {
    expect(canonicalSha256({ integerValue: "1" }))
      .not.toBe(canonicalSha256({ doubleValue: 1 }));
    expect(normalizeFirestoreValue({ doubleValue: -0 })).toEqual({ doubleValue: 0 });
  });

  it("ProtoJSONで省略されたGeoPointの0軸をcanonical化する", () => {
    expect(normalizeFirestoreValue({ geoPointValue: {} })).toEqual({
      geoPointValue: { latitude: 0, longitude: 0 },
    });
    expect(normalizeFirestoreValue({ geoPointValue: { latitude: 35 } })).toEqual({
      geoPointValue: { latitude: 35, longitude: 0 },
    });
    expect(normalizeFirestoreValue({ geoPointValue: { longitude: 139 } })).toEqual({
      geoPointValue: { latitude: 0, longitude: 139 },
    });
  });

  it("map key順に依存せず決定的なhashを生成する", () => {
    const left = { b: { stringValue: "b" }, a: { integerValue: "1" } };
    const right = { a: { integerValue: "1" }, b: { stringValue: "b" } };
    expect(canonicalSha256(left)).toBe(canonicalSha256(right));
    expect(snapshotFieldSha256(`${DATABASE_PREFIX}/documents/tanks/T-001`, left))
      .toBe(snapshotFieldSha256(`${DATABASE_PREFIX}/documents/tanks/T-001`, right));
  });

  it("union重複、未知field、int64範囲外、別database referenceを拒否する", () => {
    expect(() => normalizeFirestoreValue({ stringValue: "x", integerValue: "1" }))
      .toThrow("正確に1つ");
    expect(() => normalizeFirestoreValue({ futureValue: "x" }))
      .toThrow("正確に1つ");
    expect(() => normalizeFirestoreValue({ integerValue: "9223372036854775808" }))
      .toThrow("int64範囲外");
    expect(() => normalizeFirestoreValue({ integerValue: "-0" }))
      .toThrow("canonical int64");
    expect(() => normalizeFirestoreValue({ timestampValue: "2026-99-99T00:00:00Z" }))
      .toThrow("RFC3339");
    expect(() => normalizeFirestoreDocument({
      name: `${DATABASE_PREFIX}/documents/tanks/T-001`,
      fields: {
        ref: { referenceValue: "projects/other/databases/(default)/documents/tanks/T-002" },
      },
      createTime: "2026-07-13T00:00:00Z",
      updateTime: "2026-07-13T00:00:01Z",
    }, DATABASE_PREFIX)).toThrow("別database");
  });

  it("snapshot kind、root collection、marker、inventory、subcollection確認数を相互検証する", () => {
    const valid = fixturePayload();
    expect(() => validateTransitionSnapshotPayload(valid)).not.toThrow();

    const wrongKind = structuredClone(valid);
    wrongKind.documents[0].kind = "tank_log";
    expect(() => validateTransitionSnapshotPayload(wrongKind)).toThrow("root collection");

    const wrongMarker = structuredClone(valid);
    wrongMarker.manifest.migrationMarkerPath = "migrationMarkers/other";
    expect(() => validateTransitionSnapshotPayload(wrongMarker)).toThrow("marker path");

    const wrongInventory = structuredClone(valid);
    wrongInventory.manifest.inventory.totalLogs = 1;
    expect(() => validateTransitionSnapshotPayload(wrongInventory)).toThrow("inventory");

    const missingSubcollectionCheck = structuredClone(valid);
    missingSubcollectionCheck.manifest.subcollectionsChecked = 1;
    expect(() => validateTransitionSnapshotPayload(missingSubcollectionCheck))
      .toThrow("subcollection確認数");
  });
});

function fixturePayload(): TransitionSnapshotPayloadV1 {
  const fields = {
    status: { stringValue: "lent" } as const,
    capacity: { integerValue: "10" } as const,
  };
  const name = `${DATABASE_PREFIX}/documents/tanks/T-001`;
  const document: TransitionSnapshotDocumentV1 = {
    kind: "tank",
    name,
    fields,
    createTime: "2026-07-13T00:00:00Z",
    updateTime: "2026-07-13T00:00:01Z",
    fieldSha256: snapshotFieldSha256(name, fields),
  };
  const documents = [document];
  const inventory = {
    totalLogs: 0,
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
      snapshotId: "snapshot-canonical-test",
      createdAt: "2026-07-13T00:01:00Z",
      readTime: "2026-07-13T00:00:02Z",
      projectId: "demo-cutover",
      databaseId: "(default)",
      databaseUid: "emulator:demo-cutover:(default)",
      mainCommit: "a".repeat(40),
      keyId: "key-1",
      migrationMarkerPath: "migrationMarkers/transitionPlanRequiredV1",
      counts: { tanks: 1, tankLogs: 0, transactions: 0, restoreWrites: 2 },
      inventory,
      documentPathSha256: canonicalSha256(documents.map((item) => item.name)),
      sourceCensusSha256: canonicalSha256({
        documents: documents.map((item) => ({
          name: item.name,
          updateTime: item.updateTime,
          fieldSha256: item.fieldSha256,
        })),
        inventory,
        marker: null,
      }),
      snapshotDocumentsSha256: canonicalSha256(documents),
      subcollectionsChecked: 2,
    },
    documents,
  };
}
