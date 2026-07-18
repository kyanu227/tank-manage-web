import {
  canonicalSha256,
  canonicalStringify,
  compareCanonicalStrings,
  relativeDocumentPath,
  validateTransitionSnapshotPayload,
} from "./canonical-firestore-value";
import type {
  CutoverFirestoreClient,
  TransitionSnapshotPayloadV1,
  TransitionSourceCensus,
} from "./firestore-rest-types";
import { createTransitionResetContract } from "./transition-reset-contract";
import {
  TRANSITION_MIGRATION_MARKER_PATH,
  assertRestoreIdentity,
  readTransitionSourceCensus,
  resetProjectionFieldsFromSnapshot,
  sourceCensusSha256,
  transitionExecutionIdentity,
  type RestoreTransitionSnapshotOptions,
} from "./transition-snapshot-service";

const OBSERVATION_COUNT = 3 as const;
const DEFAULT_OBSERVATION_DELAYS_MS = [100, 400] as const;

export type TransitionCutoverVerificationStatus =
  | "reset_applied"
  | "source_or_restored_observed"
  | "unknown";

export type VerifyTransitionCutoverStateOptions = RestoreTransitionSnapshotOptions & {
  observationDelaysMs?: readonly number[];
};

export type TransitionCutoverVerificationResult = {
  status: TransitionCutoverVerificationStatus;
  applied: boolean;
  safeToRetry: false;
  observations: typeof OBSERVATION_COUNT;
  stableStateSha256: string | null;
};

type Observation = {
  status: TransitionCutoverVerificationStatus;
  stateSha256: string | null;
};

/**
 * commit結果が不明な場合に、現在状態だけを3回観測して分類する。
 * source状態が見えても遅延commitを否定できないため、再実行可能とは判定しない。
 */
export async function verifyTransitionCutoverState(
  options: VerifyTransitionCutoverStateOptions,
): Promise<TransitionCutoverVerificationResult> {
  const payload = validateTransitionSnapshotPayload(options.payload);
  assertPayloadSha256(payload, options.snapshotPayloadSha256);
  assertRestoreIdentity(payload, options);
  const executionIdentity = transitionExecutionIdentity(options);
  const delays = normalizeObservationDelays(options.observationDelaysMs);
  await options.client.verifyDatabaseUid(options.expectedDatabaseUid);

  const observations: Observation[] = [];
  for (let index = 0; index < OBSERVATION_COUNT; index += 1) {
    observations.push(await observeTransitionCutoverState(
      options.client,
      payload,
      options.snapshotPayloadSha256,
      executionIdentity,
    ));
    const delay = delays[index];
    if (delay !== undefined && delay > 0) await wait(delay);
  }

  const first = observations[0];
  const stable = Boolean(
    first?.stateSha256
    && observations.every((observation) => (
      observation.stateSha256 === first.stateSha256
      && observation.status === first.status
    )),
  );
  const status = stable && first ? first.status : "unknown";
  return {
    status,
    applied: status === "reset_applied",
    safeToRetry: false,
    observations: OBSERVATION_COUNT,
    stableStateSha256: stable && first ? first.stateSha256 : null,
  };
}

async function observeTransitionCutoverState(
  client: CutoverFirestoreClient,
  payload: TransitionSnapshotPayloadV1,
  snapshotPayloadSha256: string,
  executionIdentity: NonNullable<RestoreTransitionSnapshotOptions["executionIdentity"]>,
): Promise<Observation> {
  try {
    const census = await readTransitionSourceCensus(client);
    const subcollections = await readSubcollectionInventory(client, payload);
    const stateSha256 = canonicalSha256({
      sourceCensusSha256: sourceCensusSha256(census),
      subcollections,
    });
    if (subcollections.some((entry) => entry.collectionIds.length > 0)) {
      return { status: "unknown", stateSha256 };
    }
    if (
      isExactResetState(
        census,
        payload,
        snapshotPayloadSha256,
        client,
        executionIdentity,
      )
    ) {
      return { status: "reset_applied", stateSha256 };
    }
    if (isExactSourceOrRestoredState(census, payload)) {
      return { status: "source_or_restored_observed", stateSha256 };
    }
    return { status: "unknown", stateSha256 };
  } catch {
    return { status: "unknown", stateSha256: null };
  }
}

function isExactResetState(
  census: TransitionSourceCensus,
  payload: TransitionSnapshotPayloadV1,
  snapshotPayloadSha256: string,
  client: CutoverFirestoreClient,
  executionIdentity: NonNullable<RestoreTransitionSnapshotOptions["executionIdentity"]>,
): boolean {
  const marker = census.markerDocument;
  const resetAtValue = marker?.fields?.resetAt;
  if (
    !marker
    || marker.name !== client.fullDocumentName(TRANSITION_MIGRATION_MARKER_PATH)
    || !resetAtValue
    || !("timestampValue" in resetAtValue)
  ) {
    return false;
  }

  const expectedMarkerFields = createTransitionResetContract(
    payload,
    snapshotPayloadSha256,
    resetAtValue.timestampValue,
    executionIdentity,
  ).markerFields;
  if (canonicalStringify(marker.fields ?? {}) !== canonicalStringify(expectedMarkerFields)) {
    return false;
  }

  const expectedTanks = payload.documents.filter((document) => document.kind === "tank");
  const currentTanks = census.documents.filter((document) => document.kind === "tank");
  if (
    census.documents.some((document) => document.kind !== "tank")
    || canonicalStringify(currentTanks.map((document) => document.name))
      !== canonicalStringify(expectedTanks.map((document) => document.name))
    || census.inventory.totalLogs !== payload.manifest.inventory.preservedNonTankLogs
    || census.inventory.preservedNonTankLogs !== payload.manifest.inventory.preservedNonTankLogs
    || census.inventory.totalTransactions !== payload.manifest.inventory.preservedTransactions
    || census.inventory.preservedTransactions !== payload.manifest.inventory.preservedTransactions
  ) {
    return false;
  }

  const expectedByName = new Map(expectedTanks.map((document) => [document.name, document]));
  return currentTanks.every((current) => {
    const original = expectedByName.get(current.name);
    return Boolean(
      original
      && canonicalStringify(current.fields)
        === canonicalStringify(resetProjectionFieldsFromSnapshot(
          original,
          resetAtValue.timestampValue,
        )),
    );
  });
}

function isExactSourceOrRestoredState(
  census: TransitionSourceCensus,
  payload: TransitionSnapshotPayloadV1,
): boolean {
  if (census.markerDocument) return false;
  if (canonicalStringify(census.inventory) !== canonicalStringify(payload.manifest.inventory)) {
    return false;
  }
  if (census.documents.length !== payload.documents.length) return false;
  return census.documents.every((document, index) => {
    const expected = payload.documents[index];
    return document.name === expected?.name && document.fieldSha256 === expected.fieldSha256;
  });
}

async function readSubcollectionInventory(
  client: CutoverFirestoreClient,
  payload: TransitionSnapshotPayloadV1,
): Promise<Array<{ path: string; collectionIds: string[] }>> {
  const paths = [
    ...payload.documents.map((document) => relativeDocumentPath(
      document.name,
      client.databasePrefix,
    )),
    TRANSITION_MIGRATION_MARKER_PATH,
  ].sort(compareCanonicalStrings);
  const results: Array<{ path: string; collectionIds: string[] }> = [];
  const concurrency = 10;
  for (let offset = 0; offset < paths.length; offset += concurrency) {
    const chunk = paths.slice(offset, offset + concurrency);
    results.push(...await Promise.all(chunk.map(async (path) => ({
      path,
      collectionIds: await client.listCollectionIds(path),
    }))));
  }
  return results;
}

function assertPayloadSha256(
  payload: TransitionSnapshotPayloadV1,
  snapshotPayloadSha256: string,
): void {
  if (!/^[0-9a-f]{64}$/.test(snapshotPayloadSha256)) {
    throw new Error("snapshot payload SHA-256が不正です");
  }
  if (canonicalSha256(payload) !== snapshotPayloadSha256) {
    throw new Error("snapshot payload SHA-256がpayloadと一致しません");
  }
}

function normalizeObservationDelays(value: readonly number[] | undefined): readonly number[] {
  const delays = value ?? DEFAULT_OBSERVATION_DELAYS_MS;
  if (
    delays.length !== OBSERVATION_COUNT - 1
    || delays.some((delay) => !Number.isFinite(delay) || delay < 0 || delay > 60_000)
  ) {
    throw new Error("3回観測には0〜60000msの待機時間を2つ指定してください");
  }
  return delays;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}
