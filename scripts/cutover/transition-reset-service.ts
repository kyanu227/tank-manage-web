import { TANK_OPERATION_PROJECTION_FIELDS } from "../reset-transition-plan-v1-core";
import {
  canonicalSha256,
  canonicalStringify,
  compareCanonicalStrings,
  relativeDocumentPath,
  validateTransitionSnapshotPayload,
} from "./canonical-firestore-value";
import type {
  CutoverFirestoreClient,
  FirestoreWrite,
  TransitionSnapshotPayloadV1,
  TransitionSourceCensus,
} from "./firestore-rest-types";
import {
  TRANSITION_MIGRATION_MARKER_PATH,
  assertCommitBounds,
  assertRestoreIdentity,
  deterministicCommitRequestBytes,
  readTransitionSourceCensus,
  resetProjectionFieldsFromSnapshot,
  sourceCensusSha256,
  transitionExecutionIdentity,
  type RestoreTransitionSnapshotOptions,
} from "./transition-snapshot-service";
import { createTransitionResetContract } from "./transition-reset-contract";
import { withCutoverDiagnosticCode } from "./cutover-diagnostic-error";

export { statusCountsFromSnapshot } from "./transition-reset-contract";

export type TransitionSnapshotResetOptions = RestoreTransitionSnapshotOptions & {
  now?: () => Date;
  ambiguousReadbackDelaysMs?: readonly number[];
  resetProductionAuthorizationProvider?: (
    plan: TransitionResetPlan,
  ) => unknown;
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
  snapshotId: string;
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

type AuthenticatedTransitionResetPlanContext = {
  projectId: string;
  databaseId: string;
  databaseUid: string | undefined;
  dataPrincipal: string | undefined;
  operatorPrincipal: string;
  mainCommit: string;
};

const authenticTransitionResetPlans = new WeakMap<
  object,
  AuthenticatedTransitionResetPlanContext
>();

/** production commit認可は、実plannerがlive censusから生成したplanだけを受理する。 */
export function assertAuthenticTransitionResetPlan(
  plan: TransitionResetPlan,
): void {
  if (!authenticTransitionResetPlans.has(plan) || !Object.isFrozen(plan)) {
    throw new Error("reset serviceが生成した凍結planではありません");
  }
}

export function authenticatedTransitionResetPlanContext(
  plan: TransitionResetPlan,
): AuthenticatedTransitionResetPlanContext {
  assertAuthenticTransitionResetPlan(plan);
  return authenticTransitionResetPlans.get(plan)!;
}

// Data Resetで保持してよいtank基本情報。未知fieldを基本情報だと推測しない。
const KNOWN_TANK_BASIC_INFORMATION_FIELDS = new Set([
  "id",
  "tankId",
  "tankNumber",
  "prefix",
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
  "notes",
  "tags",
  "createdAt",
]);

export async function planTransitionSnapshotReset(
  options: TransitionSnapshotResetOptions,
): Promise<TransitionResetPlan> {
  const executionIdentity = transitionExecutionIdentity(options);
  const payload = validateTransitionSnapshotPayload(options.payload);
  assertPayloadSha256(options.snapshotPayloadSha256, payload);
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
    executionIdentity,
  );
  const writes = buildTransitionResetWrites(
    payload,
    options.snapshotPayloadSha256,
    contract.resetAt,
    options.client,
    executionIdentity,
  );
  const requestBytes = deterministicCommitRequestBytes(writes);
  assertCommitBounds(writes.length, requestBytes);
  return sealTransitionResetPlan({
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
      snapshotId: payload.manifest.snapshotId,
      snapshotPayloadSha256: options.snapshotPayloadSha256,
      sourceCensusSha256: payload.manifest.sourceCensusSha256,
      resetPlanSha256: contract.resetPlanSha256,
    },
  }, {
    projectId: options.client.projectId,
    databaseId: options.client.databaseId,
    databaseUid: options.client.getVerifiedDatabaseUid(),
    dataPrincipal: options.client.dataPrincipal,
    operatorPrincipal: executionIdentity.operatorPrincipal,
    mainCommit: options.expectedMainCommit,
  });
}

export async function executeTransitionSnapshotReset(
  options: TransitionSnapshotResetOptions,
): Promise<TransitionResetPlan & {
  commitTime: string | null;
  commitResponse: "confirmed" | "verified_after_ambiguous_response";
}> {
  let plan: TransitionResetPlan;
  try {
    plan = await planTransitionSnapshotReset(options);
  } catch (error) {
    throw withCutoverDiagnosticCode(error, "RESET_PLAN_FAILED");
  }
  let authorization: unknown;
  try {
    authorization = options.resetProductionAuthorizationProvider?.(plan);
  } catch (error) {
    throw withCutoverDiagnosticCode(error, "RESET_AUTHORIZATION_FAILED");
  }
  let result: Awaited<ReturnType<typeof options.client.commit>>;
  try {
    result = await options.client.commit("reset", plan.writes, authorization);
  } catch (commitError) {
    const outcome = await classifyAmbiguousResetOutcome(options, plan);
    if (outcome.status === "applied") {
      return {
        ...plan,
        commitTime: null,
        commitResponse: "verified_after_ambiguous_response",
      };
    }
    const aggregate = new AggregateError(
      [commitError, ...(outcome.error ? [outcome.error] : [])],
      outcome.status === "not_observed"
        ? "reset commit応答が失敗し、反復read-back時点では適用を確認できませんでした（未適用とは断定できません）"
        : "reset commit応答が失敗し、反復read-backでも適用状態を確定できません",
      { cause: commitError },
    );
    throw withCutoverDiagnosticCode(
      aggregate,
      outcome.status === "not_observed"
        ? "RESET_COMMIT_NOT_OBSERVED"
        : "RESET_COMMIT_STATE_UNKNOWN",
    );
  }

  try {
    await assertTransitionSnapshotResetApplied(options, plan);
  } catch (error) {
    throw withCutoverDiagnosticCode(error, "RESET_POST_VERIFY_FAILED");
  }
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

function sealTransitionResetPlan(
  plan: TransitionResetPlan,
  context: AuthenticatedTransitionResetPlanContext,
): TransitionResetPlan {
  freezeDeep(plan);
  authenticTransitionResetPlans.set(plan, Object.freeze({ ...context }));
  return plan;
}

function freezeDeep(value: unknown): void {
  if (!value || typeof value !== "object") return;
  Object.values(value).forEach(freezeDeep);
  if (!Object.isFrozen(value)) Object.freeze(value);
}

function buildTransitionResetWrites(
  payloadInput: TransitionSnapshotPayloadV1,
  snapshotPayloadSha256: string,
  resetAt: string,
  client: CutoverFirestoreClient,
  executionIdentity: NonNullable<RestoreTransitionSnapshotOptions["executionIdentity"]>,
): FirestoreWrite[] {
  const payload = validateTransitionSnapshotPayload(payloadInput);
  assertPayloadSha256(snapshotPayloadSha256, payload);
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
      fields: createTransitionResetContract(
        payload,
        snapshotPayloadSha256,
        resetAt,
        executionIdentity,
      ).markerFields,
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
    transitionExecutionIdentity(options),
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
  client: CutoverFirestoreClient,
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
  client: CutoverFirestoreClient,
): string[] {
  return [
    ...payload.documents.map((document) => (
      relativeDocumentPath(document.name, client.databasePrefix)
    )),
    TRANSITION_MIGRATION_MARKER_PATH,
  ].sort(compareCanonicalStrings);
}

function assertPayloadSha256(value: string, payload: TransitionSnapshotPayloadV1): void {
  if (!/^[0-9a-f]{64}$/.test(value) || canonicalSha256(payload) !== value) {
    throw new Error("snapshot payload SHA-256が不正です");
  }
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}
