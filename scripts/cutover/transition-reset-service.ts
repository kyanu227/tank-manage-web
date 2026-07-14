import { TANK_OPERATION_PROJECTION_FIELDS } from "../reset-transition-plan-v1-core";
import {
  canonicalStringify,
  compareCanonicalStrings,
  relativeDocumentPath,
  validateTransitionSnapshotPayload,
} from "./canonical-firestore-value";
import {
  FirestoreRestClient,
  serializeFirestoreRestBody,
} from "./firestore-rest-client";
import type {
  FirestoreWrite,
  TransitionSnapshotPayloadV1,
  TransitionSourceCensus,
} from "./firestore-rest-types";
import {
  TRANSITION_MIGRATION_MARKER_PATH,
  assertCommitBounds,
  assertRestoreIdentity,
  readTransitionSourceCensus,
  resetProjectionFieldsFromSnapshot,
  sourceCensusSha256,
  type RestoreTransitionSnapshotOptions,
} from "./transition-snapshot-service";
import { createTransitionResetContract } from "./transition-reset-contract";

export { statusCountsFromSnapshot } from "./transition-reset-contract";

export type TransitionSnapshotResetOptions = RestoreTransitionSnapshotOptions & {
  now?: () => Date;
  ambiguousReadbackDelaysMs?: readonly number[];
};

export type TransitionResetSummary = {
  counts: {
    tanks: number;
    tankLogs: number;
    transactions: number;
  };
  statusCounts: Record<string, number>;
  writes: number;
  requestBytes: number;
  snapshotPayloadSha256: string;
  sourceCensusSha256: string;
  resetPlanSha256: string;
};

export type TransitionResetPlan = {
  writes: FirestoreWrite[];
  requestBytes: number;
  resetAt: string;
  summary: TransitionResetSummary;
};

// Data Resetで保持してよいtank基本情報。未知fieldを基本情報だと推測しない。
const KNOWN_TANK_BASIC_INFORMATION_FIELDS = new Set([
  "id",
  "tankNumber",
  "type",
  "capacity",
  "serialNumber",
  "manufacturingNumber",
  "manufacturer",
  "manufacturedAt",
  "manufactureDate",
  "purchaseDate",
  "purchasePrice",
  "purchaseVendor",
  "vendor",
  "unitCost",
  "pressure",
  "workingPressure",
  "testPressure",
  "pressureTestDate",
  "hydroTestDate",
  "maintenanceDate",
  "nextMaintenanceDate",
  "note",
  "createdAt",
]);

export async function planTransitionSnapshotReset(
  options: TransitionSnapshotResetOptions,
): Promise<TransitionResetPlan> {
  assertPayloadSha256(options.snapshotPayloadSha256);
  const payload = validateTransitionSnapshotPayload(options.payload);
  assertKnownTankResetFields(payload);
  assertRestoreIdentity(payload, options);
  await options.client.verifyDatabaseUid(options.expectedDatabaseUid);

  const first = await readTransitionSourceCensus(options.client);
  assertSourceMatchesSnapshot(first, payload);
  const inspectionPaths = resetInspectionPaths(payload, options.client);
  await assertNoResetSubcollections(options.client, inspectionPaths);

  // subcollection確認の前後でpath・updateTime・field hash・inventoryを再照合する。
  const final = await readTransitionSourceCensus(options.client);
  assertSourceMatchesSnapshot(final, payload);
  if (sourceCensusSha256(first) !== sourceCensusSha256(final)) {
    throw new Error("reset plan作成中に対象documentが変化したため停止しました");
  }
  await assertNoResetSubcollections(options.client, inspectionPaths);
  const commitReady = await readTransitionSourceCensus(options.client);
  assertSourceMatchesSnapshot(commitReady, payload);
  if (sourceCensusSha256(final) !== sourceCensusSha256(commitReady)) {
    throw new Error("reset commit直前に対象documentが変化したため停止しました");
  }

  const contract = createTransitionResetContract(
    payload,
    options.snapshotPayloadSha256,
    (options.now ?? (() => new Date()))().toISOString(),
  );
  const writes = buildTransitionResetWrites(
    payload,
    options.snapshotPayloadSha256,
    contract.resetAt,
    options.client,
  );
  const requestBytes = Buffer.byteLength(serializeFirestoreRestBody({ writes }), "utf8");
  assertCommitBounds(writes.length, requestBytes);
  return {
    writes,
    requestBytes,
    resetAt: contract.resetAt,
    summary: {
      counts: {
        tanks: payload.manifest.counts.tanks,
        tankLogs: payload.manifest.counts.tankLogs,
        transactions: payload.manifest.counts.transactions,
      },
      statusCounts: contract.statusCounts,
      writes: writes.length,
      requestBytes,
      snapshotPayloadSha256: options.snapshotPayloadSha256,
      sourceCensusSha256: payload.manifest.sourceCensusSha256,
      resetPlanSha256: contract.resetPlanSha256,
    },
  };
}

export async function executeTransitionSnapshotReset(
  options: TransitionSnapshotResetOptions,
): Promise<TransitionResetPlan & {
  commitTime: string | null;
  commitResponse: "confirmed" | "verified_after_ambiguous_response";
}> {
  if (!options.client.emulatorHost) {
    throw new Error(
      "本番reset executeはfreeze Rules・rules bypass writer停止・runbookの実装PRが完了するまで無効です",
    );
  }
  const plan = await planTransitionSnapshotReset(options);
  let result: Awaited<ReturnType<typeof options.client.commit>>;
  try {
    result = await options.client.commit(plan.writes);
  } catch (commitError) {
    const outcome = await classifyAmbiguousResetOutcome(options, plan);
    if (outcome.status === "applied") {
      return {
        ...plan,
        commitTime: null,
        commitResponse: "verified_after_ambiguous_response",
      };
    }
    throw new AggregateError(
      [commitError, ...(outcome.error ? [outcome.error] : [])],
      outcome.status === "not_observed"
        ? "reset commit応答が失敗し、反復read-back時点では適用を確認できませんでした（未適用とは断定できません）"
        : "reset commit応答が失敗し、反復read-backでも適用状態を確定できません",
    );
  }

  await assertTransitionSnapshotResetApplied(options, plan);
  if (
    typeof result.commitTime !== "string"
    || !result.commitTime
    || result.writeResults?.length !== plan.writes.length
  ) {
    return {
      ...plan,
      commitTime: typeof result.commitTime === "string" && result.commitTime
        ? result.commitTime
        : null,
      commitResponse: "verified_after_ambiguous_response",
    };
  }
  return { ...plan, commitTime: result.commitTime, commitResponse: "confirmed" };
}

function buildTransitionResetWrites(
  payloadInput: TransitionSnapshotPayloadV1,
  snapshotPayloadSha256: string,
  resetAt: string,
  client: FirestoreRestClient,
): FirestoreWrite[] {
  assertPayloadSha256(snapshotPayloadSha256);
  const payload = validateTransitionSnapshotPayload(payloadInput);
  assertKnownTankResetFields(payload);
  const writes = payload.documents.map((document): FirestoreWrite => {
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
      name: client.fullDocumentName(payload.manifest.migrationMarkerPath),
      fields: createTransitionResetContract(payload, snapshotPayloadSha256, resetAt).markerFields,
    },
    currentDocument: { exists: false },
  });
  return writes;
}

export async function assertTransitionSnapshotResetApplied(
  options: TransitionSnapshotResetOptions,
  plan: TransitionResetPlan,
): Promise<void> {
  const payload = validateTransitionSnapshotPayload(options.payload);
  const census = await readTransitionSourceCensus(options.client);
  const currentTanks = census.documents.filter((document) => document.kind === "tank");
  const currentTankLogs = census.documents.filter((document) => document.kind === "tank_log");
  const currentTransactions = census.documents.filter((document) => document.kind === "transaction");
  const originalTanks = payload.documents.filter((document) => document.kind === "tank");

  if (currentTankLogs.length > 0 || currentTransactions.length > 0) {
    throw new Error("reset後に対象tank logまたはtransactionが残っています");
  }
  if (
    canonicalStringify(currentTanks.map((document) => document.name))
    !== canonicalStringify(originalTanks.map((document) => document.name))
  ) {
    throw new Error("reset後のtank path setがsnapshotと一致しません");
  }
  if (
    census.inventory.totalLogs !== payload.manifest.inventory.preservedNonTankLogs
    || census.inventory.preservedNonTankLogs !== payload.manifest.inventory.preservedNonTankLogs
    || census.inventory.totalTransactions !== payload.manifest.inventory.preservedTransactions
    || census.inventory.preservedTransactions !== payload.manifest.inventory.preservedTransactions
  ) {
    throw new Error("reset後の対象外log/transaction inventoryがsnapshotと一致しません");
  }

  const originalByName = new Map(originalTanks.map((document) => [document.name, document]));
  currentTanks.forEach((document) => {
    const original = originalByName.get(document.name);
    if (!original) throw new Error("reset後にsnapshot外のtankがあります");
    const expectedFields = resetProjectionFieldsFromSnapshot(original, plan.resetAt);
    if (canonicalStringify(document.fields) !== canonicalStringify(expectedFields)) {
      throw new Error("reset後のtank projectionまたは基本情報が期待状態と一致しません");
    }
  });

  const expectedMarkerFields = createTransitionResetContract(
    payload,
    options.snapshotPayloadSha256,
    plan.resetAt,
  ).markerFields;
  const marker = census.markerDocument;
  if (!marker || marker.name !== options.client.fullDocumentName(TRANSITION_MIGRATION_MARKER_PATH)) {
    throw new Error("reset後のcompleted migration markerがありません");
  }
  if (canonicalStringify(marker.fields ?? {}) !== canonicalStringify(expectedMarkerFields)) {
    throw new Error("reset後のmigration markerが期待契約と一致しません");
  }
  await assertNoResetSubcollections(
    options.client,
    resetInspectionPaths(payload, options.client),
  );
}

async function classifyAmbiguousResetOutcome(
  options: TransitionSnapshotResetOptions,
  plan: TransitionResetPlan,
): Promise<{
  status: "applied" | "not_observed" | "unknown";
  error?: unknown;
}> {
  const delays = options.ambiguousReadbackDelaysMs ?? [100, 400];
  let lastOutcome: {
    status: "applied" | "not_observed" | "unknown";
    error?: unknown;
  } = { status: "unknown" };
  for (let attempt = 0; attempt <= delays.length; attempt += 1) {
    try {
      await assertTransitionSnapshotResetApplied(options, plan);
      return { status: "applied" };
    } catch (verificationError) {
      try {
        const census = await readTransitionSourceCensus(options.client);
        if (
          census.markerDocument === null
          && sourceCensusSha256(census) === options.payload.manifest.sourceCensusSha256
        ) {
          await assertNoResetSubcollections(
            options.client,
            resetInspectionPaths(options.payload, options.client),
          );
          // timeout後にserver側commitが遅延適用される可能性があるため、未適用とは断定しない。
          lastOutcome = { status: "not_observed", error: verificationError };
        } else {
          lastOutcome = { status: "unknown", error: verificationError };
        }
      } catch (classificationError) {
        lastOutcome = { status: "unknown", error: classificationError };
      }
    }
    const delayMs = delays[attempt];
    if (delayMs !== undefined && delayMs > 0) await wait(delayMs);
  }
  return lastOutcome;
}

export function assertKnownTankResetFields(payload: TransitionSnapshotPayloadV1): void {
  const unknownFields = new Set<string>();
  payload.documents
    .filter((document) => document.kind === "tank")
    .forEach((document) => {
      Object.keys(document.fields).forEach((fieldName) => {
        if (
          !TANK_OPERATION_PROJECTION_FIELDS.has(fieldName)
          && !KNOWN_TANK_BASIC_INFORMATION_FIELDS.has(fieldName)
        ) {
          unknownFields.add(fieldName);
        }
      });
    });
  if (unknownFields.size > 0) {
    throw new Error(
      `tank fieldを基本情報または操作projectionへ分類できないためresetを停止しました（${unknownFields.size}種類）`,
    );
  }
}

function assertSourceMatchesSnapshot(
  census: TransitionSourceCensus,
  payload: TransitionSnapshotPayloadV1,
): void {
  if (census.markerDocument) {
    throw new Error("migration markerが既に存在するためresetできません");
  }
  if (sourceCensusSha256(census) !== payload.manifest.sourceCensusSha256) {
    throw new Error(
      "snapshot取得後に対象path・updateTime・field・inventoryのいずれかが変化したためresetを停止しました",
    );
  }
}

async function assertNoResetSubcollections(
  client: FirestoreRestClient,
  relativePaths: string[],
): Promise<void> {
  const concurrency = 10;
  for (let offset = 0; offset < relativePaths.length; offset += concurrency) {
    const chunk = relativePaths.slice(offset, offset + concurrency);
    const results = await Promise.all(chunk.map(async (path) => ({
      path,
      collectionIds: await client.listCollectionIds(path),
    })));
    if (results.some((result) => result.collectionIds.length > 0)) {
      throw new Error("reset対象document配下にsubcollectionがあるため停止しました");
    }
  }
}

function resetInspectionPaths(
  payload: TransitionSnapshotPayloadV1,
  client: FirestoreRestClient,
): string[] {
  return [
    ...payload.documents.map((document) => (
      relativeDocumentPath(document.name, client.databasePrefix)
    )),
    TRANSITION_MIGRATION_MARKER_PATH,
  ].sort(compareCanonicalStrings);
}

function assertPayloadSha256(value: string): void {
  if (!/^[0-9a-f]{64}$/.test(value)) {
    throw new Error("snapshot payload SHA-256が不正です");
  }
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}
