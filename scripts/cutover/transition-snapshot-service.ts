import { randomUUID } from "node:crypto";
import {
  MIGRATION_MARKER_ID,
  TANK_OPERATION_PROJECTION_FIELDS,
  classifyLogKind,
  classifyTransactionType,
} from "../reset-transition-plan-v1-core";
import {
  canonicalSha256,
  canonicalStringify,
  compareCanonicalStrings,
  normalizeFirestoreDocument,
  relativeDocumentPath,
  snapshotFieldSha256,
  validateTransitionSnapshotPayload,
} from "./canonical-firestore-value";
import type {
  CutoverFirestoreClient,
  FirestoreRestDocument,
  FirestoreRestValue,
  FirestoreWrite,
  TransitionSnapshotDocumentKind,
  TransitionSnapshotDocumentV1,
  TransitionSnapshotInventoryV1,
  TransitionSnapshotPayloadV1,
  TransitionSourceCensus,
} from "./firestore-rest-types";
import {
  emulatorExecutionIdentity,
  type ProductionExecutionIntent,
  type TransitionExecutionIdentity,
} from "./production-execution-contract";
import {
  createTransitionResetContract,
  type TransitionResetContract,
} from "./transition-reset-contract";

export const MAX_CUTOVER_COMMIT_WRITES = 400;
export const MAX_CUTOVER_COMMIT_BYTES = 8 * 1024 * 1024;
export const TRANSITION_MIGRATION_MARKER_PATH = `migrationMarkers/${MIGRATION_MARKER_ID}`;

type SourceCollection = "tanks" | "logs" | "transactions" | "migrationMarkers";
const REQUIRED_RESET_STATUS = "empty";
const REQUIRED_RESET_LOCATION = "倉庫";
const MAX_TIMESTAMP_PRECONDITION = "9999-12-31T23:59:59.999999999Z";

export type CaptureTransitionSnapshotOptions = {
  client: CutoverFirestoreClient;
  databaseUid: string;
  mainCommit: string;
  keyId: string;
  now?: () => Date;
  snapshotId?: string;
};

export type RestoreTransitionSnapshotOptions = {
  client: CutoverFirestoreClient;
  payload: TransitionSnapshotPayloadV1;
  snapshotPayloadSha256: string;
  expectedProjectId: string;
  expectedDatabaseId: string;
  expectedDatabaseUid: string;
  expectedMainCommit: string;
  executionIdentity?: TransitionExecutionIdentity;
  executionIntent?: ProductionExecutionIntent;
  ambiguousReadbackDelaysMs?: readonly number[];
  restoreProductionAuthorizationProvider?: (
    plan: TransitionRestorePlan,
  ) => unknown;
};

export type TransitionRestorePlan = {
  writes: FirestoreWrite[];
  requestBytes: number;
  summary: {
    tanks: number;
    tankLogs: number;
    transactions: number;
    writes: number;
    requestBytes: number;
    snapshotId: string;
    snapshotPayloadSha256: string;
    sourceCensusSha256: string;
    resetPlanSha256: string;
  };
};

type AuthenticatedTransitionRestorePlanContext = {
  projectId: string;
  databaseId: string;
  databaseUid: string | undefined;
  dataPrincipal: string | undefined;
  operatorPrincipal: string;
  mainCommit: string;
};

const authenticTransitionRestorePlans = new WeakMap<
  object,
  AuthenticatedTransitionRestorePlanContext
>();

/** production commit認可は、実plannerがreset済みlive stateから生成したplanだけを受理する。 */
export function assertAuthenticTransitionRestorePlan(
  plan: TransitionRestorePlan,
): void {
  if (!authenticTransitionRestorePlans.has(plan) || !Object.isFrozen(plan)) {
    throw new Error("restore serviceが生成した凍結planではありません");
  }
}

export function authenticatedTransitionRestorePlanContext(
  plan: TransitionRestorePlan,
): AuthenticatedTransitionRestorePlanContext {
  assertAuthenticTransitionRestorePlan(plan);
  return authenticTransitionRestorePlans.get(plan)!;
}

export async function captureTransitionSnapshot(
  options: CaptureTransitionSnapshotOptions,
): Promise<TransitionSnapshotPayloadV1> {
  await options.client.verifyDatabaseUid(options.databaseUid);
  const first = await readTransitionSourceCensus(options.client);
  if (first.markerDocument) {
    throw new Error(`${TRANSITION_MIGRATION_MARKER_PATH}が既に存在するためsnapshotを作成できません`);
  }
  await assertNoSubcollections(
    options.client,
    snapshotInspectionPaths(first.documents, options.client),
  );
  const second = await readTransitionSourceCensus(options.client);
  if (second.markerDocument) {
    throw new Error("subcollection検査中にmigration markerが作成されたためsnapshotを中止しました");
  }
  if (sourceCensusSha256(first) !== sourceCensusSha256(second)) {
    throw new Error("snapshot読取中に対象documentが変化したため保存を中止しました");
  }
  await assertNoSubcollections(
    options.client,
    snapshotInspectionPaths(second.documents, options.client),
  );
  const finalCensus = await readTransitionSourceCensus(options.client);
  if (finalCensus.markerDocument) {
    throw new Error("subcollection再検査中にmigration markerが作成されたためsnapshotを中止しました");
  }
  if (sourceCensusSha256(second) !== sourceCensusSha256(finalCensus)) {
    throw new Error("snapshot最終検査中に対象documentが変化したため保存を中止しました");
  }

  const documents = [...finalCensus.documents].sort((left, right) => (
    compareCanonicalStrings(left.name, right.name)
  ));
  const manifest = {
    version: 1 as const,
    scope: "transitionPlanRequiredV1" as const,
    snapshotId: options.snapshotId ?? randomUUID(),
    createdAt: (options.now ?? (() => new Date()))().toISOString(),
    readTime: finalCensus.readTime,
    projectId: options.client.projectId,
    databaseId: options.client.databaseId,
    databaseUid: options.databaseUid,
    mainCommit: options.mainCommit,
    keyId: options.keyId,
    migrationMarkerPath: TRANSITION_MIGRATION_MARKER_PATH,
    counts: {
      tanks: documents.filter((document) => document.kind === "tank").length,
      tankLogs: documents.filter((document) => document.kind === "tank_log").length,
      transactions: documents.filter((document) => document.kind === "transaction").length,
      restoreWrites: documents.length + 1,
    },
    inventory: finalCensus.inventory,
    documentPathSha256: canonicalSha256(documents.map((document) => document.name)),
    sourceCensusSha256: sourceCensusSha256(finalCensus),
    snapshotDocumentsSha256: canonicalSha256(documents),
    subcollectionsChecked: documents.length + 1,
  };
  const payload = validateTransitionSnapshotPayload({ manifest, documents });
  assertSnapshotCanRestoreAtomically(payload, options.client);
  return payload;
}

export async function readTransitionSourceCensus(
  client: CutoverFirestoreClient,
): Promise<TransitionSourceCensus> {
  const transaction = await client.beginReadOnlyTransaction();
  try {
    const results: Record<SourceCollection, Awaited<ReturnType<typeof client.runCollectionQuery>>> = {
      tanks: await client.runCollectionQuery("tanks", transaction),
      logs: await client.runCollectionQuery("logs", transaction),
      transactions: await client.runCollectionQuery("transactions", transaction),
      migrationMarkers: await client.runCollectionQuery("migrationMarkers", transaction),
    };
    const normalizedTanks = normalizeDocuments(results.tanks.documents, client.databasePrefix);
    const normalizedLogs = normalizeDocuments(results.logs.documents, client.databasePrefix);
    const normalizedTransactions = normalizeDocuments(
      results.transactions.documents,
      client.databasePrefix,
    );
    const normalizedMarkers = normalizeDocuments(
      results.migrationMarkers.documents,
      client.databasePrefix,
    );

    const tankDocuments = normalizedTanks.map((document) => toSnapshotDocument("tank", document));
    const tankLogs: TransitionSnapshotDocumentV1[] = [];
    let preservedNonTankLogs = 0;
    const unknownLogs: string[] = [];
    normalizedLogs.forEach((document) => {
      const classification = classifyLogKind(restString(document.fields.logKind));
      if (classification === "tank") tankLogs.push(toSnapshotDocument("tank_log", document));
      else if (classification === "preserved_non_tank") preservedNonTankLogs += 1;
      else unknownLogs.push(document.name);
    });

    const targetTransactions: TransitionSnapshotDocumentV1[] = [];
    let preservedTransactions = 0;
    const unknownTransactions: string[] = [];
    normalizedTransactions.forEach((document) => {
      const classification = classifyTransactionType(restString(document.fields.type));
      if (classification === "delete") {
        targetTransactions.push(toSnapshotDocument("transaction", document));
      } else if (classification === "preserve") {
        preservedTransactions += 1;
      } else {
        unknownTransactions.push(document.name);
      }
    });
    if (unknownLogs.length > 0) {
      throw new Error(`logKindを判定できないlogが${unknownLogs.length}件あるためsnapshotを作成できません`);
    }
    if (unknownTransactions.length > 0) {
      throw new Error(`typeを判定できないtransactionが${unknownTransactions.length}件あるためsnapshotを作成できません`);
    }

    const markerName = client.fullDocumentName(TRANSITION_MIGRATION_MARKER_PATH);
    const markerDocument = normalizedMarkers.find((document) => document.name === markerName) ?? null;
    const inventory: TransitionSnapshotInventoryV1 = {
      totalLogs: normalizedLogs.length,
      preservedNonTankLogs,
      unknownLogs: 0,
      totalTransactions: normalizedTransactions.length,
      preservedTransactions,
      unknownTransactions: 0,
    };
    const readTime = [
      results.tanks.readTime,
      results.logs.readTime,
      results.transactions.readTime,
      results.migrationMarkers.readTime,
    ].sort().at(-1)!;
    return {
      documents: [...tankDocuments, ...tankLogs, ...targetTransactions]
        .sort((left, right) => compareCanonicalStrings(left.name, right.name)),
      readTime,
      inventory,
      markerDocument,
    };
  } finally {
    await client.rollback(transaction).catch(() => undefined);
  }
}

export async function planTransitionSnapshotRestore(
  options: RestoreTransitionSnapshotOptions,
): Promise<TransitionRestorePlan> {
  const executionIdentity = transitionExecutionIdentity(options);
  const payload = validateTransitionSnapshotPayload(options.payload);
  if (
    !/^[0-9a-f]{64}$/.test(options.snapshotPayloadSha256)
    || canonicalSha256(payload) !== options.snapshotPayloadSha256
  ) {
    throw new Error("snapshot payload SHA-256が不正です");
  }
  assertRestoreIdentity(payload, options);
  await options.client.verifyDatabaseUid(options.expectedDatabaseUid);

  const current = await readTransitionSourceCensus(options.client);
  assertRestoreCurrentState(
    current,
    payload,
    options.snapshotPayloadSha256,
    options.client,
    executionIdentity,
  );
  const inspectionPaths = snapshotInspectionPaths(payload.documents, options.client);
  await assertNoSubcollections(options.client, inspectionPaths);

  // subcollection検査後に再読取し、最新updateTimeをpreconditionへ使用する。
  const finalCurrent = await readTransitionSourceCensus(options.client);
  const resetContract = assertRestoreCurrentState(
    finalCurrent,
    payload,
    options.snapshotPayloadSha256,
    options.client,
    executionIdentity,
  );
  await assertNoSubcollections(options.client, inspectionPaths);
  const writes = buildRestoreWrites(payload, finalCurrent, options.client);
  const requestBytes = Buffer.byteLength(canonicalStringify({ writes }), "utf8");
  assertCommitBounds(writes.length, requestBytes);
  return sealTransitionRestorePlan({
    writes,
    requestBytes,
    summary: {
      tanks: payload.manifest.counts.tanks,
      tankLogs: payload.manifest.counts.tankLogs,
      transactions: payload.manifest.counts.transactions,
      writes: writes.length,
      requestBytes,
      snapshotId: payload.manifest.snapshotId,
      snapshotPayloadSha256: options.snapshotPayloadSha256,
      sourceCensusSha256: payload.manifest.sourceCensusSha256,
      resetPlanSha256: resetContract.resetPlanSha256,
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

export async function executeTransitionSnapshotRestore(
  options: RestoreTransitionSnapshotOptions,
): Promise<TransitionRestorePlan & {
  commitTime: string | null;
  commitResponse: "confirmed" | "verified_after_ambiguous_response";
}> {
  const plan = await planTransitionSnapshotRestore(options);
  const authorization = options.restoreProductionAuthorizationProvider?.(plan);
  let result: Awaited<ReturnType<typeof options.client.commit>>;
  try {
    result = await options.client.commit("restore", plan.writes, authorization);
  } catch (commitError) {
    try {
      await assertRestoredAfterAmbiguousCommit(options);
      return {
        ...plan,
        commitTime: null,
        commitResponse: "verified_after_ambiguous_response",
      };
    } catch (verificationError) {
      throw new AggregateError(
        [commitError, verificationError],
        "restore commit応答が失敗し、read-backで完全復元も確認できません",
      );
    }
  }
  await assertRestoredSnapshot(options);
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

async function assertRestoredAfterAmbiguousCommit(
  options: RestoreTransitionSnapshotOptions,
): Promise<void> {
  const delays = options.ambiguousReadbackDelaysMs ?? [100, 400];
  let lastError: unknown;
  for (let attempt = 0; attempt <= delays.length; attempt += 1) {
    try {
      await assertRestoredSnapshot(options);
      return;
    } catch (error) {
      lastError = error;
    }
    const delayMs = delays[attempt];
    if (delayMs !== undefined && delayMs > 0) await wait(delayMs);
  }
  throw lastError;
}

function sealTransitionRestorePlan(
  plan: TransitionRestorePlan,
  context: AuthenticatedTransitionRestorePlanContext,
): TransitionRestorePlan {
  freezeDeep(plan);
  authenticTransitionRestorePlans.set(plan, Object.freeze({ ...context }));
  return plan;
}

function freezeDeep(value: unknown): void {
  if (!value || typeof value !== "object") return;
  Object.values(value).forEach(freezeDeep);
  if (!Object.isFrozen(value)) Object.freeze(value);
}

async function wait(delayMs: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
}

export function transitionExecutionIdentity(
  options: Pick<RestoreTransitionSnapshotOptions, "client" | "executionIdentity">,
): TransitionExecutionIdentity {
  if (options.executionIdentity) {
    if (
      !options.client.emulatorHost
      && options.client.dataPrincipal !== options.executionIdentity.dataPrincipal
    ) {
      throw new Error("execution identityのdata principalが検証済みclient principalと一致しません");
    }
    return options.executionIdentity;
  }
  if (options.client.emulatorHost) return emulatorExecutionIdentity();
  throw new Error("本番cutoverにはexecution identityが必須です");
}

export function buildRestoreWrites(
  payload: TransitionSnapshotPayloadV1,
  current: TransitionSourceCensus,
  client: CutoverFirestoreClient,
): FirestoreWrite[] {
  const currentByName = new Map(current.documents.map((document) => [document.name, document]));
  const writes = payload.documents.map((document): FirestoreWrite => {
    if (document.kind === "tank") {
      const currentTank = currentByName.get(document.name);
      if (!currentTank) throw new Error(`${document.name}がreset後のtank censusにありません`);
      return {
        update: { name: document.name, fields: document.fields },
        currentDocument: { updateTime: currentTank.updateTime },
      };
    }
    return {
      update: { name: document.name, fields: document.fields },
      currentDocument: { exists: false },
    };
  });
  if (!current.markerDocument?.updateTime) {
    throw new Error("migration markerのupdateTimeを取得できません");
  }
  writes.push({
    delete: client.fullDocumentName(payload.manifest.migrationMarkerPath),
    currentDocument: { updateTime: current.markerDocument.updateTime },
  });
  return writes;
}

export function sourceCensusSha256(census: TransitionSourceCensus): string {
  return canonicalSha256({
    documents: census.documents.map((document) => ({
      name: document.name,
      updateTime: document.updateTime,
      fieldSha256: document.fieldSha256,
    })),
    inventory: census.inventory,
    marker: census.markerDocument
      ? {
          name: census.markerDocument.name,
          updateTime: census.markerDocument.updateTime,
          fields: census.markerDocument.fields ?? {},
        }
      : null,
  });
}

export function resetProjectionFieldsFromSnapshot(
  document: TransitionSnapshotDocumentV1,
  updatedAt: string,
): Record<string, FirestoreRestValue> {
  if (document.kind !== "tank") throw new Error("tank snapshotだけreset projectionへ変換できます");
  const preserved = Object.fromEntries(
    Object.entries(document.fields).filter(([key]) => !TANK_OPERATION_PROJECTION_FIELDS.has(key)),
  );
  return {
    ...preserved,
    status: { stringValue: REQUIRED_RESET_STATUS },
    location: { stringValue: REQUIRED_RESET_LOCATION },
    updatedAt: { timestampValue: updatedAt },
  };
}

export function assertCommitBounds(writeCount: number, requestBytes: number): void {
  if (writeCount > MAX_CUTOVER_COMMIT_WRITES) {
    throw new Error(`cutover commitが内部上限${MAX_CUTOVER_COMMIT_WRITES} writesを超えています`);
  }
  if (requestBytes > MAX_CUTOVER_COMMIT_BYTES) {
    throw new Error(`cutover commitが内部上限${MAX_CUTOVER_COMMIT_BYTES} bytesを超えています`);
  }
}

export function assertSnapshotCanRestoreAtomically(
  payloadInput: TransitionSnapshotPayloadV1,
  client: CutoverFirestoreClient,
): void {
  const payload = validateTransitionSnapshotPayload(payloadInput);
  const writes: FirestoreWrite[] = payload.documents.map((document) => (
    document.kind === "tank"
      ? {
          update: { name: document.name, fields: document.fields },
          currentDocument: { updateTime: MAX_TIMESTAMP_PRECONDITION },
        }
      : {
          update: { name: document.name, fields: document.fields },
          currentDocument: { exists: false },
        }
  ));
  writes.push({
    delete: client.fullDocumentName(payload.manifest.migrationMarkerPath),
    currentDocument: { updateTime: MAX_TIMESTAMP_PRECONDITION },
  });
  assertCommitBounds(
    writes.length,
    Buffer.byteLength(canonicalStringify({ writes }), "utf8"),
  );
}

async function assertNoSubcollections(
  client: CutoverFirestoreClient,
  relativePaths: string[],
): Promise<void> {
  const concurrency = 10;
  for (let offset = 0; offset < relativePaths.length; offset += concurrency) {
    const chunk = relativePaths.slice(offset, offset + concurrency);
    const results = await Promise.all(chunk.map(async (path) => {
      return { path, collectionIds: await client.listCollectionIds(path) };
    }));
    const withSubcollections = results.filter((result) => result.collectionIds.length > 0);
    if (withSubcollections.length > 0) {
      throw new Error(
        `snapshot対象document配下にsubcollectionがあります（${withSubcollections.length}件）。限定snapshotを中止します`,
      );
    }
  }
}

function snapshotInspectionPaths(
  documents: TransitionSnapshotDocumentV1[],
  client: CutoverFirestoreClient,
): string[] {
  return [
    ...documents.map((document) => relativeDocumentPath(document.name, client.databasePrefix)),
    TRANSITION_MIGRATION_MARKER_PATH,
  ].sort(compareCanonicalStrings);
}

export function assertRestoreIdentity(
  payload: TransitionSnapshotPayloadV1,
  options: RestoreTransitionSnapshotOptions,
): void {
  const manifest = payload.manifest;
  if (manifest.projectId !== options.expectedProjectId || manifest.projectId !== options.client.projectId) {
    throw new Error("snapshot project IDが実行先と一致しません");
  }
  if (manifest.databaseId !== options.expectedDatabaseId || manifest.databaseId !== options.client.databaseId) {
    throw new Error("snapshot database IDが実行先と一致しません");
  }
  if (manifest.databaseUid !== options.expectedDatabaseUid) {
    throw new Error("snapshot database UIDが実行先と一致しません");
  }
  if (manifest.mainCommit !== options.expectedMainCommit) {
    throw new Error("snapshot main commitが指定値と一致しません");
  }
}

function assertRestoreCurrentState(
  current: TransitionSourceCensus,
  payload: TransitionSnapshotPayloadV1,
  snapshotPayloadSha256: string,
  client: CutoverFirestoreClient,
  executionIdentity: TransitionExecutionIdentity,
): TransitionResetContract {
  const originalTanks = payload.documents.filter((document) => document.kind === "tank");
  const currentTanks = current.documents.filter((document) => document.kind === "tank");
  const currentTankLogs = current.documents.filter((document) => document.kind === "tank_log");
  const currentTransactions = current.documents.filter((document) => document.kind === "transaction");
  if (currentTankLogs.length > 0 || currentTransactions.length > 0) {
    throw new Error("reset後に対象tank logまたはtransactionが存在するためrestoreを停止しました");
  }
  if (canonicalStringify(currentTanks.map((document) => document.name))
    !== canonicalStringify(originalTanks.map((document) => document.name))) {
    throw new Error("reset後のtank path setがsnapshotと一致しません");
  }
  if (
    current.inventory.preservedNonTankLogs !== payload.manifest.inventory.preservedNonTankLogs
    || current.inventory.preservedTransactions !== payload.manifest.inventory.preservedTransactions
  ) {
    throw new Error("reset対象外log/transactionの件数がsnapshot時点と一致しません");
  }

  const originalByName = new Map(originalTanks.map((document) => [document.name, document]));
  const resetAt = restTimestamp(current.markerDocument?.fields?.resetAt);
  if (!resetAt) throw new Error("migration markerのresetAtがありません");
  currentTanks.forEach((currentTank) => {
    const original = originalByName.get(currentTank.name);
    if (!original) throw new Error(`${currentTank.name}がsnapshotにありません`);
    assertTankIsExpectedResetState(currentTank, original, resetAt);
  });

  const marker = current.markerDocument;
  if (!marker) throw new Error("completed migration markerがないためrestoreできません");
  const expectedMarkerName = client.fullDocumentName(payload.manifest.migrationMarkerPath);
  if (marker.name !== expectedMarkerName) throw new Error("migration marker pathが一致しません");
  const markerFields = marker.fields ?? {};
  if (restString(markerFields.status) !== "completed") {
    throw new Error("migration markerがcompletedではありません");
  }
  if (restString(markerFields.snapshotId) !== payload.manifest.snapshotId) {
    throw new Error("migration markerのsnapshot IDが一致しません");
  }
  if (restString(markerFields.snapshotPayloadSha256) !== snapshotPayloadSha256) {
    throw new Error("migration markerのsnapshot payload SHA-256が一致しません");
  }
  const expectedContract = createTransitionResetContract(
    payload,
    snapshotPayloadSha256,
    resetAt,
    executionIdentity,
  );
  if (
    canonicalStringify(markerFields)
    !== canonicalStringify(expectedContract.markerFields)
  ) {
    throw new Error("migration markerがsnapshot由来のreset契約と一致しません");
  }
  return expectedContract;
}

function assertTankIsExpectedResetState(
  current: TransitionSnapshotDocumentV1,
  original: TransitionSnapshotDocumentV1,
  resetAt: string,
): void {
  if (restString(current.fields.status) !== REQUIRED_RESET_STATUS) {
    throw new Error(`${current.name}: statusがemptyではありません`);
  }
  if (restString(current.fields.location) !== REQUIRED_RESET_LOCATION) {
    throw new Error(`${current.name}: locationが倉庫ではありません`);
  }
  const expectedFields = resetProjectionFieldsFromSnapshot(original, resetAt);
  if (canonicalStringify(current.fields) !== canonicalStringify(expectedFields)) {
    const fieldNames = [...new Set([
      ...Object.keys(current.fields),
      ...Object.keys(expectedFields),
    ])].sort(compareCanonicalStrings);
    const mismatchedFields = fieldNames.filter((fieldName) => (
      canonicalStringify(current.fields[fieldName])
      !== canonicalStringify(expectedFields[fieldName])
    ));
    throw new Error(
      `${current.name}: reset後の全fieldがmarker.resetAt由来の期待状態と一致しません`
      + ` (fields: ${mismatchedFields.join(", ")}`
      + `${mismatchedFields.length === 1 && mismatchedFields[0] === "updatedAt"
        ? `, current=${canonicalStringify(current.fields.updatedAt)}, expected=${canonicalStringify(expectedFields.updatedAt)}`
        : ""})`,
    );
  }
}

async function assertRestoredSnapshot(options: RestoreTransitionSnapshotOptions): Promise<void> {
  const restored = await readTransitionSourceCensus(options.client);
  if (restored.markerDocument) {
    throw new Error("restore後にmigration markerが残っています");
  }
  const expectedDocuments = [...options.payload.documents].sort((left, right) => (
    compareCanonicalStrings(left.name, right.name)
  ));
  if (restored.documents.length !== expectedDocuments.length) {
    throw new Error("restore後のdocument件数がsnapshotと一致しません");
  }
  restored.documents.forEach((document, index) => {
    const expected = expectedDocuments[index];
    if (document.name !== expected?.name || document.fieldSha256 !== expected.fieldSha256) {
      throw new Error(`restore後のdocument pathまたはfield SHA-256が一致しません: ${document.name}`);
    }
  });
  if (canonicalStringify(restored.inventory) !== canonicalStringify(options.payload.manifest.inventory)) {
    throw new Error("restore後のlog/transaction inventoryがsnapshotと一致しません");
  }
  await assertNoSubcollections(
    options.client,
    snapshotInspectionPaths(options.payload.documents, options.client),
  );
}

function normalizeDocuments(
  documents: FirestoreRestDocument[],
  databasePrefix: string,
) {
  return documents
    .map((document) => normalizeFirestoreDocument(document, databasePrefix))
    .sort((left, right) => compareCanonicalStrings(left.name, right.name));
}

function toSnapshotDocument(
  kind: TransitionSnapshotDocumentKind,
  document: ReturnType<typeof normalizeFirestoreDocument>,
): TransitionSnapshotDocumentV1 {
  return {
    kind,
    name: document.name,
    fields: document.fields,
    createTime: document.createTime,
    updateTime: document.updateTime,
    fieldSha256: snapshotFieldSha256(document.name, document.fields),
  };
}

function restString(value: FirestoreRestValue | undefined): string {
  return value && "stringValue" in value ? value.stringValue.trim() : "";
}

function restTimestamp(value: FirestoreRestValue | undefined): string {
  return value && "timestampValue" in value ? value.timestampValue : "";
}
