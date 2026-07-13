import { createHash } from "node:crypto";
import {
  MIGRATION_MARKER_ID,
  classifyLogKind,
  classifyTransactionType,
} from "../reset-transition-plan-v1-core";
import type {
  FirestoreRestDocument,
  FirestoreRestValue,
  TransitionSnapshotDocumentV1,
  TransitionSnapshotPayloadV1,
} from "./firestore-rest-types";

const VALUE_KEYS = new Set([
  "nullValue",
  "booleanValue",
  "integerValue",
  "doubleValue",
  "timestampValue",
  "stringValue",
  "bytesValue",
  "referenceValue",
  "geoPointValue",
  "arrayValue",
  "mapValue",
]);
const INT64_MIN = BigInt("-9223372036854775808");
const INT64_MAX = BigInt("9223372036854775807");
const TIMESTAMP_PATTERN = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const TRANSITION_MIGRATION_MARKER_PATH = `migrationMarkers/${MIGRATION_MARKER_ID}`;
const SNAPSHOT_COLLECTION_BY_KIND = {
  tank: "tanks",
  tank_log: "logs",
  transaction: "transactions",
} as const;

export function canonicalStringify(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (Number.isNaN(value)) return '"NaN"';
    if (value === Infinity) return '"Infinity"';
    if (value === -Infinity) return '"-Infinity"';
    if (Object.is(value, -0)) return "-0";
    if (!Number.isFinite(value)) throw new Error("canonical JSONへ変換できないnumberです");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalStringify).join(",")}]`;
  }
  if (!value || typeof value !== "object") {
    throw new Error(`canonical JSONへ変換できない型です: ${typeof value}`);
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, nested]) => nested !== undefined)
    .sort(([left], [right]) => compareCanonicalStrings(left, right));
  return `{${entries.map(([key, nested]) => (
    `${JSON.stringify(key)}:${canonicalStringify(nested)}`
  )).join(",")}}`;
}

export function compareCanonicalStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function sha256Hex(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function canonicalSha256(value: unknown): string {
  return sha256Hex(canonicalStringify(value));
}

export function normalizeFirestoreValue(value: unknown, fieldPath = "value"): FirestoreRestValue {
  const record = objectRecord(value, fieldPath);
  const keys = Object.keys(record);
  if (keys.length !== 1 || !VALUE_KEYS.has(keys[0])) {
    throw new Error(`${fieldPath}はFirestore Valueのunion fieldを正確に1つ持つ必要があります`);
  }

  const key = keys[0];
  switch (key) {
    case "nullValue":
      if (record.nullValue !== null) throw new Error(`${fieldPath}.nullValueが不正です`);
      return { nullValue: null };
    case "booleanValue":
      if (typeof record.booleanValue !== "boolean") {
        throw new Error(`${fieldPath}.booleanValueが不正です`);
      }
      return { booleanValue: record.booleanValue };
    case "integerValue":
      return { integerValue: normalizeInt64(record.integerValue, `${fieldPath}.integerValue`) };
    case "doubleValue":
      return { doubleValue: normalizeDouble(record.doubleValue, `${fieldPath}.doubleValue`) };
    case "timestampValue":
      return { timestampValue: normalizeTimestamp(record.timestampValue, `${fieldPath}.timestampValue`) };
    case "stringValue":
      if (typeof record.stringValue !== "string") {
        throw new Error(`${fieldPath}.stringValueが不正です`);
      }
      return { stringValue: record.stringValue };
    case "bytesValue":
      return { bytesValue: normalizeBase64(record.bytesValue, `${fieldPath}.bytesValue`) };
    case "referenceValue":
      if (typeof record.referenceValue !== "string" || !record.referenceValue.trim()) {
        throw new Error(`${fieldPath}.referenceValueが不正です`);
      }
      return { referenceValue: record.referenceValue };
    case "geoPointValue": {
      const point = objectRecord(record.geoPointValue, `${fieldPath}.geoPointValue`);
      assertOnlyKeys(point, ["latitude", "longitude"], `${fieldPath}.geoPointValue`);
      const latitude = finiteNumber(point.latitude, `${fieldPath}.geoPointValue.latitude`);
      const longitude = finiteNumber(point.longitude, `${fieldPath}.geoPointValue.longitude`);
      if (latitude < -90 || latitude > 90) throw new Error(`${fieldPath}のlatitudeが範囲外です`);
      if (longitude < -180 || longitude > 180) throw new Error(`${fieldPath}のlongitudeが範囲外です`);
      return { geoPointValue: { latitude, longitude } };
    }
    case "arrayValue": {
      const array = objectRecord(record.arrayValue, `${fieldPath}.arrayValue`);
      assertOnlyKeys(array, ["values"], `${fieldPath}.arrayValue`);
      const values = array.values === undefined
        ? []
        : arrayValue(array.values, `${fieldPath}.arrayValue.values`).map(
            (nested, index) => normalizeFirestoreValue(
              nested,
              `${fieldPath}.arrayValue.values[${index}]`,
            ),
          );
      return { arrayValue: values.length > 0 ? { values } : {} };
    }
    case "mapValue": {
      const map = objectRecord(record.mapValue, `${fieldPath}.mapValue`);
      assertOnlyKeys(map, ["fields"], `${fieldPath}.mapValue`);
      const fields = map.fields === undefined
        ? {}
        : normalizeFirestoreFields(map.fields, `${fieldPath}.mapValue.fields`);
      return { mapValue: Object.keys(fields).length > 0 ? { fields } : {} };
    }
    default:
      throw new Error(`${fieldPath}に未対応のFirestore Valueがあります`);
  }
}

export function normalizeFirestoreFields(
  fields: unknown,
  fieldPath = "fields",
): Record<string, FirestoreRestValue> {
  const record = objectRecord(fields, fieldPath);
  return Object.fromEntries(
    Object.entries(record)
      .sort(([left], [right]) => compareCanonicalStrings(left, right))
      .map(([key, value]) => [key, normalizeFirestoreValue(value, `${fieldPath}.${key}`)]),
  );
}

export function normalizeFirestoreDocument(
  document: unknown,
  expectedDatabasePrefix: string,
): FirestoreRestDocument & {
  fields: Record<string, FirestoreRestValue>;
  createTime: string;
  updateTime: string;
} {
  const record = objectRecord(document, "document");
  assertOnlyKeys(record, ["name", "fields", "createTime", "updateTime"], "document");
  if (typeof record.name !== "string" || !record.name.startsWith(`${expectedDatabasePrefix}/documents/`)) {
    throw new Error("snapshot対象documentのdatabase prefixが一致しません");
  }
  const fields = normalizeFirestoreFields(record.fields ?? {}, `${record.name}.fields`);
  assertReferencePrefixes(fields, expectedDatabasePrefix, record.name);
  return {
    name: record.name,
    fields,
    createTime: normalizeTimestamp(record.createTime, `${record.name}.createTime`),
    updateTime: normalizeTimestamp(record.updateTime, `${record.name}.updateTime`),
  };
}

export function snapshotFieldSha256(
  name: string,
  fields: Record<string, FirestoreRestValue>,
): string {
  return canonicalSha256({ name, fields });
}

export function validateTransitionSnapshotPayload(
  input: unknown,
): TransitionSnapshotPayloadV1 {
  const payload = objectRecord(input, "snapshot payload");
  assertOnlyKeys(payload, ["manifest", "documents"], "snapshot payload");
  const manifest = objectRecord(payload.manifest, "manifest");
  const documentsInput = arrayValue(payload.documents, "documents");

  assertOnlyKeys(manifest, [
    "version", "scope", "snapshotId", "createdAt", "readTime", "projectId", "databaseId",
    "databaseUid", "mainCommit", "keyId", "migrationMarkerPath", "counts", "inventory",
    "documentPathSha256", "sourceCensusSha256", "snapshotDocumentsSha256",
    "subcollectionsChecked",
  ], "manifest");
  if (manifest.version !== 1 || manifest.scope !== "transitionPlanRequiredV1") {
    throw new Error("snapshot manifestのversionまたはscopeが不正です");
  }
  const projectId = nonEmptyString(manifest.projectId, "manifest.projectId");
  const databaseId = nonEmptyString(manifest.databaseId, "manifest.databaseId");
  const databasePrefix = `projects/${projectId}/databases/${databaseId}`;
  const counts = normalizeCounts(manifest.counts);
  const inventory = normalizeInventory(manifest.inventory);

  const documents = documentsInput.map((rawDocument, index): TransitionSnapshotDocumentV1 => {
    const record = objectRecord(rawDocument, `documents[${index}]`);
    assertOnlyKeys(record, [
      "kind", "name", "fields", "createTime", "updateTime", "fieldSha256",
    ], `documents[${index}]`);
    if (record.kind !== "tank" && record.kind !== "tank_log" && record.kind !== "transaction") {
      throw new Error(`documents[${index}].kindが不正です`);
    }
    const normalized = normalizeFirestoreDocument({
      name: record.name,
      fields: record.fields,
      createTime: record.createTime,
      updateTime: record.updateTime,
    }, databasePrefix);
    const documentPath = relativeDocumentPath(normalized.name, databasePrefix);
    const pathSegments = documentPath.split("/");
    if (
      pathSegments.length !== 2
      || pathSegments[0] !== SNAPSHOT_COLLECTION_BY_KIND[record.kind]
      || !pathSegments[1]
    ) {
      throw new Error(`${normalized.name}のkindとroot collectionが一致しません`);
    }
    if (
      record.kind === "tank_log"
      && classifyLogKind(snapshotStringField(normalized.fields.logKind)) !== "tank"
    ) {
      throw new Error(`${normalized.name}はlogKind=tankではありません`);
    }
    if (
      record.kind === "transaction"
      && classifyTransactionType(snapshotStringField(normalized.fields.type)) !== "delete"
    ) {
      throw new Error(`${normalized.name}はReset対象transaction typeではありません`);
    }
    const fieldSha256 = sha256String(record.fieldSha256, `documents[${index}].fieldSha256`);
    if (snapshotFieldSha256(normalized.name, normalized.fields) !== fieldSha256) {
      throw new Error(`${normalized.name}のfield SHA-256が一致しません`);
    }
    return { kind: record.kind, ...normalized, fieldSha256 };
  });

  const sortedDocuments = [...documents].sort((left, right) => (
    compareCanonicalStrings(left.name, right.name)
  ));
  if (documents.some((document, index) => document.name !== sortedDocuments[index]?.name)) {
    throw new Error("snapshot documentsはdocument path順である必要があります");
  }
  if (new Set(documents.map((document) => document.name)).size !== documents.length) {
    throw new Error("snapshot documentsに重複pathがあります");
  }

  const actualCounts = {
    tanks: documents.filter((document) => document.kind === "tank").length,
    tankLogs: documents.filter((document) => document.kind === "tank_log").length,
    transactions: documents.filter((document) => document.kind === "transaction").length,
    restoreWrites: documents.length + 1,
  };
  if (canonicalStringify(actualCounts) !== canonicalStringify(counts)) {
    throw new Error("snapshot manifestの件数がdocument payloadと一致しません");
  }
  if (actualCounts.tanks === 0) {
    throw new Error("snapshotに対象tankがありません");
  }
  if (
    inventory.totalLogs !== actualCounts.tankLogs + inventory.preservedNonTankLogs
    || inventory.totalTransactions !== actualCounts.transactions + inventory.preservedTransactions
  ) {
    throw new Error("snapshot manifestのinventory件数がdocument payloadと一致しません");
  }

  const subcollectionsChecked = nonNegativeInteger(
    manifest.subcollectionsChecked,
    "manifest.subcollectionsChecked",
  );
  if (subcollectionsChecked !== documents.length + 1) {
    throw new Error("snapshot対象documentのsubcollection確認数が一致しません");
  }
  const migrationMarkerPath = nonEmptyString(
    manifest.migrationMarkerPath,
    "manifest.migrationMarkerPath",
  );
  if (migrationMarkerPath !== TRANSITION_MIGRATION_MARKER_PATH) {
    throw new Error("snapshot manifestのmigration marker pathが不正です");
  }

  const pathsSha = canonicalSha256(documents.map((document) => document.name));
  const documentsSha = canonicalSha256(documents);
  const censusSha = canonicalSha256({
    documents: documents.map((document) => ({
      name: document.name,
      updateTime: document.updateTime,
      fieldSha256: document.fieldSha256,
    })),
    inventory,
    marker: null,
  });
  if (pathsSha !== sha256String(manifest.documentPathSha256, "manifest.documentPathSha256")) {
    throw new Error("snapshotのdocument path SHA-256が一致しません");
  }
  if (documentsSha !== sha256String(manifest.snapshotDocumentsSha256, "manifest.snapshotDocumentsSha256")) {
    throw new Error("snapshot documents SHA-256が一致しません");
  }
  if (censusSha !== sha256String(manifest.sourceCensusSha256, "manifest.sourceCensusSha256")) {
    throw new Error("snapshot source census SHA-256が一致しません");
  }

  return {
    manifest: {
      version: 1,
      scope: "transitionPlanRequiredV1",
      snapshotId: nonEmptyString(manifest.snapshotId, "manifest.snapshotId"),
      createdAt: normalizeTimestamp(manifest.createdAt, "manifest.createdAt"),
      readTime: normalizeTimestamp(manifest.readTime, "manifest.readTime"),
      projectId,
      databaseId,
      databaseUid: nonEmptyString(manifest.databaseUid, "manifest.databaseUid"),
      mainCommit: gitSha(manifest.mainCommit, "manifest.mainCommit"),
      keyId: nonEmptyString(manifest.keyId, "manifest.keyId"),
      migrationMarkerPath,
      counts,
      inventory,
      documentPathSha256: pathsSha,
      sourceCensusSha256: censusSha,
      snapshotDocumentsSha256: documentsSha,
      subcollectionsChecked,
    },
    documents,
  };
}

export function relativeDocumentPath(name: string, databasePrefix: string): string {
  const prefix = `${databasePrefix}/documents/`;
  if (!name.startsWith(prefix)) throw new Error(`document nameが${databasePrefix}配下ではありません`);
  return name.slice(prefix.length);
}

function assertReferencePrefixes(
  fields: Record<string, FirestoreRestValue>,
  databasePrefix: string,
  documentName: string,
): void {
  const visit = (value: FirestoreRestValue, path: string): void => {
    if ("referenceValue" in value) {
      if (!value.referenceValue.startsWith(`${databasePrefix}/documents/`)) {
        throw new Error(`${documentName}.${path}のreferenceValueが別databaseを参照しています`);
      }
      return;
    }
    if ("arrayValue" in value) {
      value.arrayValue.values?.forEach((nested, index) => visit(nested, `${path}[${index}]`));
      return;
    }
    if ("mapValue" in value) {
      Object.entries(value.mapValue.fields ?? {}).forEach(([key, nested]) => {
        visit(nested, `${path}.${key}`);
      });
    }
  };
  Object.entries(fields).forEach(([key, value]) => visit(value, key));
}

function normalizeCounts(value: unknown) {
  const counts = objectRecord(value, "manifest.counts");
  assertOnlyKeys(counts, ["tanks", "tankLogs", "transactions", "restoreWrites"], "manifest.counts");
  return {
    tanks: nonNegativeInteger(counts.tanks, "manifest.counts.tanks"),
    tankLogs: nonNegativeInteger(counts.tankLogs, "manifest.counts.tankLogs"),
    transactions: nonNegativeInteger(counts.transactions, "manifest.counts.transactions"),
    restoreWrites: nonNegativeInteger(counts.restoreWrites, "manifest.counts.restoreWrites"),
  };
}

function normalizeInventory(value: unknown) {
  const inventory = objectRecord(value, "manifest.inventory");
  assertOnlyKeys(inventory, [
    "totalLogs", "preservedNonTankLogs", "unknownLogs", "totalTransactions",
    "preservedTransactions", "unknownTransactions",
  ], "manifest.inventory");
  const unknownLogs = nonNegativeInteger(inventory.unknownLogs, "manifest.inventory.unknownLogs");
  const unknownTransactions = nonNegativeInteger(
    inventory.unknownTransactions,
    "manifest.inventory.unknownTransactions",
  );
  if (unknownLogs !== 0 || unknownTransactions !== 0) {
    throw new Error("unknown recordを含むsnapshotは利用できません");
  }
  return {
    totalLogs: nonNegativeInteger(inventory.totalLogs, "manifest.inventory.totalLogs"),
    preservedNonTankLogs: nonNegativeInteger(
      inventory.preservedNonTankLogs,
      "manifest.inventory.preservedNonTankLogs",
    ),
    unknownLogs: 0 as const,
    totalTransactions: nonNegativeInteger(
      inventory.totalTransactions,
      "manifest.inventory.totalTransactions",
    ),
    preservedTransactions: nonNegativeInteger(
      inventory.preservedTransactions,
      "manifest.inventory.preservedTransactions",
    ),
    unknownTransactions: 0 as const,
  };
}

function snapshotStringField(value: FirestoreRestValue | undefined): string {
  return value && "stringValue" in value ? value.stringValue : "";
}

function normalizeInt64(value: unknown, path: string): string {
  if (typeof value !== "string" || !/^-?(?:0|[1-9]\d*)$/.test(value)) {
    throw new Error(`${path}はcanonical int64文字列ではありません`);
  }
  if (value === "-0") throw new Error(`${path}はcanonical int64文字列ではありません`);
  const parsed = BigInt(value);
  if (parsed < INT64_MIN || parsed > INT64_MAX) throw new Error(`${path}がint64範囲外です`);
  return value;
}

function normalizeDouble(
  value: unknown,
  path: string,
): number | "NaN" | "Infinity" | "-Infinity" {
  if (value === "NaN" || value === "Infinity" || value === "-Infinity") return value;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${path}が不正です`);
  // Firestoreは0.0と-0.0を同一のzeroとして扱い、Emulator読取も0へ正規化する。
  if (Object.is(value, -0)) return 0;
  return value;
}

function normalizeTimestamp(value: unknown, path: string): string {
  if (typeof value !== "string") {
    throw new Error(`${path}はUTC RFC3339 timestampではありません`);
  }
  const match = TIMESTAMP_PATTERN.exec(value);
  if (!match || Number.isNaN(Date.parse(value))) {
    throw new Error(`${path}はUTC RFC3339 timestampではありません`);
  }
  const [seconds, fraction = ""] = [match[1], match[2] ?? ""];
  const parsed = new Date(value);
  if (parsed.toISOString().slice(0, 19) !== seconds) {
    throw new Error(`${path}は実在するUTC timestampではありません`);
  }
  const canonicalFraction = fraction.replace(/0+$/, "");
  return `${seconds}${canonicalFraction ? `.${canonicalFraction}` : ""}Z`;
}

function normalizeBase64(value: unknown, path: string): string {
  if (typeof value !== "string" || !isCanonicalBase64(value)) {
    throw new Error(`${path}はcanonical base64ではありません`);
  }
  return value;
}

function isCanonicalBase64(value: string): boolean {
  if (value.length % 4 !== 0) return false;
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    return false;
  }
  return Buffer.from(value, "base64").toString("base64") === value;
}

function nonEmptyString(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim() || value !== value.trim()) {
    throw new Error(`${path}は前後に空白のない必須文字列です`);
  }
  return value;
}

function sha256String(value: unknown, path: string): string {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    throw new Error(`${path}はSHA-256 hexではありません`);
  }
  return value;
}

function gitSha(value: unknown, path: string): string {
  if (typeof value !== "string" || !/^[0-9a-f]{40}$/.test(value)) {
    throw new Error(`${path}は40文字のGit SHAではありません`);
  }
  return value;
}

function finiteNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${path}が不正です`);
  return value;
}

function nonNegativeInteger(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${path}は0以上の整数である必要があります`);
  }
  return value;
}

function objectRecord(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path}はobjectである必要があります`);
  }
  return value as Record<string, unknown>;
}

function arrayValue(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${path}はarrayである必要があります`);
  return value;
}

function assertOnlyKeys(record: Record<string, unknown>, keys: string[], path: string): void {
  const allowed = new Set(keys);
  const unknown = Object.keys(record).filter((key) => !allowed.has(key));
  if (unknown.length > 0) throw new Error(`${path}に未知fieldがあります: ${unknown.join(", ")}`);
}
