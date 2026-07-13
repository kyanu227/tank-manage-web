import { coerceTankStatusCode } from "../../src/lib/tank-action-status-codes";
import { TANK_OPERATION_PROJECTION_FIELDS } from "../reset-transition-plan-v1-core";
import {
  canonicalSha256,
  compareCanonicalStrings,
  normalizeFirestoreValue,
  validateTransitionSnapshotPayload,
} from "./canonical-firestore-value";
import type {
  FirestoreRestValue,
  TransitionSnapshotPayloadV1,
} from "./firestore-rest-types";

export type TransitionResetContract = {
  resetAt: string;
  statusCounts: Record<string, number>;
  resetPlanSha256: string;
  markerFields: Record<string, FirestoreRestValue>;
};

export function createTransitionResetContract(
  payloadInput: TransitionSnapshotPayloadV1,
  snapshotPayloadSha256: string,
  resetAtInput: string,
): TransitionResetContract {
  if (!/^[0-9a-f]{64}$/.test(snapshotPayloadSha256)) {
    throw new Error("snapshot payload SHA-256が不正です");
  }
  const payload = validateTransitionSnapshotPayload(payloadInput);
  const resetAtValue = normalizeFirestoreValue(
    { timestampValue: resetAtInput },
    "resetAt",
  );
  if (!("timestampValue" in resetAtValue)) throw new Error("resetAtを正規化できません");
  const resetAt = resetAtValue.timestampValue;
  const statusCounts = statusCountsFromSnapshot(payload);

  // 実行時刻だけを除外し、dry-runとexecuteで同じ業務plan hashを比較できるようにする。
  const resetPlanSha256 = canonicalSha256({
    contractVersion: 1,
    scope: payload.manifest.scope,
    projectId: payload.manifest.projectId,
    databaseId: payload.manifest.databaseId,
    databaseUid: payload.manifest.databaseUid,
    mainCommit: payload.manifest.mainCommit,
    snapshotId: payload.manifest.snapshotId,
    snapshotPayloadSha256,
    snapshotDocumentsSha256: payload.manifest.snapshotDocumentsSha256,
    sourceCensusSha256: payload.manifest.sourceCensusSha256,
    documentPathSha256: payload.manifest.documentPathSha256,
    counts: payload.manifest.counts,
    statusCounts,
    migrationMarkerPath: payload.manifest.migrationMarkerPath,
    targetProjection: {
      status: "empty",
      location: "倉庫",
      clearedFields: [...TANK_OPERATION_PROJECTION_FIELDS].sort(compareCanonicalStrings),
    },
  });
  const statusCountFields = Object.fromEntries(
    Object.entries(statusCounts).map(([status, count]) => [
      status,
      { integerValue: String(count) } satisfies FirestoreRestValue,
    ]),
  );
  return {
    resetAt,
    statusCounts,
    resetPlanSha256,
    markerFields: {
      migration: { stringValue: payload.manifest.scope },
      scriptVersion: { integerValue: "1" },
      status: { stringValue: "completed" },
      projectId: { stringValue: payload.manifest.projectId },
      databaseId: { stringValue: payload.manifest.databaseId },
      databaseUid: { stringValue: payload.manifest.databaseUid },
      mainCommit: { stringValue: payload.manifest.mainCommit },
      keyId: { stringValue: payload.manifest.keyId },
      snapshotId: { stringValue: payload.manifest.snapshotId },
      snapshotPayloadSha256: { stringValue: snapshotPayloadSha256 },
      snapshotDocumentsSha256: { stringValue: payload.manifest.snapshotDocumentsSha256 },
      sourceCensusSha256: { stringValue: payload.manifest.sourceCensusSha256 },
      documentPathSha256: { stringValue: payload.manifest.documentPathSha256 },
      snapshotCreatedAt: { timestampValue: payload.manifest.createdAt },
      sourceReadTime: { timestampValue: payload.manifest.readTime },
      resetAt: { timestampValue: resetAt },
      completedAt: { timestampValue: resetAt },
      targetTankCount: { integerValue: String(payload.manifest.counts.tanks) },
      targetTankLogCount: { integerValue: String(payload.manifest.counts.tankLogs) },
      targetTransactionCount: { integerValue: String(payload.manifest.counts.transactions) },
      totalWriteCount: { integerValue: String(payload.manifest.counts.restoreWrites) },
      statusCounts: { mapValue: { fields: statusCountFields } },
      resetPlanSha256: { stringValue: resetPlanSha256 },
    },
  };
}

export function statusCountsFromSnapshot(
  payloadInput: TransitionSnapshotPayloadV1,
): Record<string, number> {
  const payload = validateTransitionSnapshotPayload(payloadInput);
  const counts = new Map<string, number>();
  payload.documents
    .filter((document) => document.kind === "tank")
    .forEach((document) => {
      const rawStatus = restString(document.fields.status);
      const status = rawStatus ? (coerceTankStatusCode(rawStatus) ?? "unknown") : "missing";
      counts.set(status, (counts.get(status) ?? 0) + 1);
    });
  return Object.fromEntries(
    [...counts.entries()].sort(([left], [right]) => compareCanonicalStrings(left, right)),
  );
}

function restString(value: FirestoreRestValue | undefined): string {
  return value && "stringValue" in value ? value.stringValue.trim() : "";
}
