/**
 * transitionPlan必須schemaへの一度限りの開発データreset。
 *
 * このリポジトリにはbackupRefを機械検証するregistry/manifestがまだないため、
 * dry-runのコードパスだけを有効にし、--executeは安全側で停止する。
 */

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import type { ServiceAccount } from "firebase-admin";
import {
  FieldValue,
  getFirestore,
  type DocumentData,
  type Firestore,
} from "firebase-admin/firestore";
import {
  MIGRATION_MARKER_ID,
  RESET_TRANSACTION_TYPES,
  assertBackupCanBeVerified,
  assertMigrationMarkerMayStart,
  assertResetPreviewHasNoUnknownRecords,
  classifyLogKind,
  classifyTransactionType,
  parseResetArguments,
  stableSnapshot,
  tankBasicInformationSnapshot,
  validateExecuteArguments,
  type ResetArguments,
} from "./reset-transition-plan-v1-core";

const PROTECTED_COLLECTIONS = ["customers", "staff", "settings", "tankProcurements"] as const;

type TankPreview = {
  tankId: string;
  beforeStatus: string;
  afterStatus: "empty";
  beforeLocation: string;
  afterLocation: "倉庫";
  previousLatestLogId: string | null;
  basicInformation: Record<string, unknown>;
};

type ResetPreview = {
  projectId: string;
  tanks: TankPreview[];
  tankLogIds: string[];
  nonTankLogSnapshots: Record<string, string>;
  unknownLogIds: string[];
  transactionIds: string[];
  unknownTransactions: Array<{ id: string; type: string }>;
  protectedCollectionSnapshots: Record<string, Record<string, string>>;
};

const args = parseResetArguments(process.argv.slice(2));

main(args).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main(input: ResetArguments): Promise<void> {
  validateExecuteArguments(input);
  initializeFirebaseAdmin(input.projectId);
  const db = getFirestore();
  assertConnectedProject(input.projectId);

  const preview = await buildPreview(db, input.projectId);
  printPreview(preview, input.execute);

  if (!input.execute) {
    console.log("dry-runのため書き込みは行っていません");
    return;
  }

  assertResetPreviewHasNoUnknownRecords(preview);

  // 現時点では必ずここで停止する。検証可能なbackup正本なしにlockやデータを書かない。
  assertBackupCanBeVerified(input);

  const executionId = randomUUID();
  const markerRef = db.collection("migrationMarkers").doc(MIGRATION_MARKER_ID);
  let lockAcquired = false;

  try {
    await acquireMigrationLock(db, input, preview, executionId);
    lockAcquired = true;
    await executeReset(db, preview);
    const verification = await verifyReset(db, preview);
    await markMigrationCompleted(db, executionId, verification);
    console.log(JSON.stringify({
      completed: true,
      projectId: input.projectId,
      marker: markerRef.path,
      executionId,
      backupRef: input.backupRef,
      ...verification,
    }, null, 2));
  } catch (error) {
    if (lockAcquired) {
      await markerRef.set({
        status: "failed",
        failedAt: FieldValue.serverTimestamp(),
        errorSummary: errorSummary(error),
      }, { merge: true });
    }
    throw error;
  }
}

async function buildPreview(db: Firestore, projectId: string): Promise<ResetPreview> {
  const [tankSnap, logSnap, transactionSnap, ...protectedSnaps] = await Promise.all([
    db.collection("tanks").get(),
    db.collection("logs").get(),
    db.collection("transactions").get(),
    ...PROTECTED_COLLECTIONS.map((collectionName) => db.collection(collectionName).get()),
  ]);

  const tanks = tankSnap.docs.map((snapshot): TankPreview => {
    const data = snapshot.data();
    return {
      tankId: snapshot.id,
      beforeStatus: stringValue(data.status) || "(missing)",
      afterStatus: "empty",
      beforeLocation: stringValue(data.location) || "(missing)",
      afterLocation: "倉庫",
      previousLatestLogId: nullableStringValue(data.latestLogId),
      basicInformation: tankBasicInformationSnapshot(data),
    };
  }).sort((left, right) => left.tankId.localeCompare(right.tankId));

  const tankLogIds: string[] = [];
  const nonTankLogSnapshots: Record<string, string> = {};
  const unknownLogIds: string[] = [];
  logSnap.docs.forEach((snapshot) => {
    const classification = classifyLogKind(snapshot.data().logKind);
    if (classification === "tank") {
      tankLogIds.push(snapshot.id);
      return;
    }
    nonTankLogSnapshots[snapshot.id] = stableSnapshot(snapshot.data());
    if (classification === "unknown") unknownLogIds.push(snapshot.id);
  });

  const transactionIds: string[] = [];
  const unknownTransactions: Array<{ id: string; type: string }> = [];
  transactionSnap.docs.forEach((snapshot) => {
    const type = stringValue(snapshot.data().type);
    const classification = classifyTransactionType(type);
    if (classification === "delete") transactionIds.push(snapshot.id);
    if (classification === "unknown") unknownTransactions.push({ id: snapshot.id, type });
  });

  return {
    projectId,
    tanks,
    tankLogIds: tankLogIds.sort(),
    nonTankLogSnapshots: sortedRecord(nonTankLogSnapshots),
    unknownLogIds: unknownLogIds.sort(),
    transactionIds: transactionIds.sort(),
    unknownTransactions: unknownTransactions.sort((left, right) => left.id.localeCompare(right.id)),
    protectedCollectionSnapshots: Object.fromEntries(
      PROTECTED_COLLECTIONS.map((collectionName, index) => [
        collectionName,
        snapshotMap(protectedSnaps[index]),
      ]),
    ),
  };
}

async function acquireMigrationLock(
  db: Firestore,
  input: ResetArguments,
  preview: ResetPreview,
  executionId: string,
): Promise<void> {
  const markerRef = db.collection("migrationMarkers").doc(MIGRATION_MARKER_ID);
  await db.runTransaction(async (transaction) => {
    const markerSnapshot = await transaction.get(markerRef);
    assertMigrationMarkerMayStart(markerSnapshot.exists ? markerSnapshot.data() : null);

    transaction.set(markerRef, {
      migration: MIGRATION_MARKER_ID,
      scriptVersion: 1,
      status: "in_progress",
      executionId,
      projectId: input.projectId,
      executedBy: input.executedBy,
      backupRef: input.backupRef,
      startedAt: FieldValue.serverTimestamp(),
      completedAt: null,
      failedAt: null,
      targetTankCount: preview.tanks.length,
      targetTankLogCount: preview.tankLogIds.length,
      targetTransactionCount: preview.transactionIds.length,
    });
  });
}

async function executeReset(db: Firestore, preview: ResetPreview): Promise<void> {
  const bulkWriter = db.bulkWriter();
  preview.tanks.forEach(({ tankId }) => {
    bulkWriter.update(db.collection("tanks").doc(tankId), {
      status: "empty",
      location: "倉庫",
      customerId: FieldValue.delete(),
      customerName: FieldValue.delete(),
      latestLogId: FieldValue.delete(),
      staff: FieldValue.delete(),
      staffId: FieldValue.delete(),
      staffName: FieldValue.delete(),
      staffEmail: FieldValue.delete(),
      lastOperationStaffId: FieldValue.delete(),
      lastOperationStaffName: FieldValue.delete(),
      lastOperationStaffEmail: FieldValue.delete(),
      logNote: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
  preview.tankLogIds.forEach((logId) => {
    bulkWriter.delete(db.collection("logs").doc(logId));
  });
  preview.transactionIds.forEach((transactionId) => {
    bulkWriter.delete(db.collection("transactions").doc(transactionId));
  });
  await bulkWriter.close();
}

async function verifyReset(db: Firestore, preview: ResetPreview): Promise<{
  tankCount: number;
  deletedTankLogCount: number;
  deletedTransactionCount: number;
}> {
  const after = await buildPreview(db, preview.projectId);
  const errors: string[] = [];

  const beforeTankIds = preview.tanks.map((tank) => tank.tankId);
  const afterTankIds = after.tanks.map((tank) => tank.tankId);
  if (stableSnapshot(beforeTankIds) !== stableSnapshot(afterTankIds)) {
    errors.push("tank document件数またはtank IDが実行前後で一致しません");
  }

  const beforeById = new Map(preview.tanks.map((tank) => [tank.tankId, tank]));
  after.tanks.forEach((tank) => {
    const before = beforeById.get(tank.tankId);
    if (!before) return;
    if (tank.beforeStatus !== "empty") errors.push(`${tank.tankId}: statusがemptyではありません`);
    if (tank.beforeLocation !== "倉庫") errors.push(`${tank.tankId}: locationが倉庫ではありません`);
    if (tank.previousLatestLogId !== null) errors.push(`${tank.tankId}: latestLogIdが残っています`);
    if (stableSnapshot(before.basicInformation) !== stableSnapshot(tank.basicInformation)) {
      errors.push(`${tank.tankId}: 基本情報が変更されています`);
    }
  });

  const tankProjectionSnapshot = await db.collection("tanks").get();
  tankProjectionSnapshot.docs.forEach((snapshot) => {
    const data = snapshot.data();
    for (const field of [
      "customerId", "customerName", "latestLogId", "staff", "staffId", "staffName",
      "staffEmail", "lastOperationStaffId", "lastOperationStaffName",
      "lastOperationStaffEmail", "logNote",
    ]) {
      if (Object.prototype.hasOwnProperty.call(data, field)) {
        errors.push(`${snapshot.id}: ${field}が削除されていません`);
      }
    }
  });

  if (after.tankLogIds.length !== 0) errors.push("logKind=tankのlogが残っています");
  if (after.transactionIds.length !== 0) {
    errors.push(`対象transaction(${RESET_TRANSACTION_TYPES.join(",")})が残っています`);
  }
  if (stableSnapshot(preview.nonTankLogSnapshots) !== stableSnapshot(after.nonTankLogSnapshots)) {
    errors.push("非tank logが意図せず変更されています");
  }
  for (const collectionName of PROTECTED_COLLECTIONS) {
    if (
      stableSnapshot(preview.protectedCollectionSnapshots[collectionName])
      !== stableSnapshot(after.protectedCollectionSnapshots[collectionName])
    ) {
      errors.push(`${collectionName}が意図せず変更されています`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`post verificationに失敗しました:\n${errors.join("\n")}`);
  }

  return {
    tankCount: after.tanks.length,
    deletedTankLogCount: preview.tankLogIds.length,
    deletedTransactionCount: preview.transactionIds.length,
  };
}

async function markMigrationCompleted(
  db: Firestore,
  executionId: string,
  result: { tankCount: number; deletedTankLogCount: number; deletedTransactionCount: number },
): Promise<void> {
  const markerRef = db.collection("migrationMarkers").doc(MIGRATION_MARKER_ID);
  await db.runTransaction(async (transaction) => {
    const markerSnapshot = await transaction.get(markerRef);
    if (
      !markerSnapshot.exists
      || markerSnapshot.data()?.status !== "in_progress"
      || markerSnapshot.data()?.executionId !== executionId
    ) {
      throw new Error("migration lockの所有者が変化したためcompletedにできません");
    }
    transaction.update(markerRef, {
      status: "completed",
      completedAt: FieldValue.serverTimestamp(),
      ...result,
    });
  });
}

function printPreview(preview: ResetPreview, execute: boolean): void {
  console.log(JSON.stringify({
    mode: execute ? "execute-requested" : "dry-run",
    projectId: preview.projectId,
    tankChanges: preview.tanks.map((tank) => ({
      tankId: tank.tankId,
      beforeStatus: tank.beforeStatus,
      afterStatus: tank.afterStatus,
      beforeLocation: tank.beforeLocation,
      afterLocation: tank.afterLocation,
      previousLatestLogId: tank.previousLatestLogId,
    })),
    counts: {
      tanksToReset: preview.tanks.length,
      tankLogsToDelete: preview.tankLogIds.length,
      transactionsToDelete: preview.transactionIds.length,
      preservedNonTankLogs: Object.keys(preview.nonTankLogSnapshots).length,
      unknownLogs: preview.unknownLogIds.length,
      unknownTransactions: preview.unknownTransactions.length,
      currentLatestLogReferences: preview.tanks.filter(
        (tank) => tank.previousLatestLogId !== null,
      ).length,
    },
    tankLogIdsToDelete: preview.tankLogIds,
    transactionIdsToDelete: preview.transactionIds,
    unknownLogIds: preview.unknownLogIds,
    unknownTransactions: preview.unknownTransactions,
  }, null, 2));
}

function initializeFirebaseAdmin(projectId: string): void {
  if (getApps().length > 0) {
    const existingProjectId = getApps()[0]?.options.projectId;
    if (existingProjectId !== projectId) {
      throw new Error(`初期化済みproject(${existingProjectId})と指定project(${projectId})が一致しません`);
    }
    return;
  }

  const explicitCredentials = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  const localServiceAccountPath = resolve(process.cwd(), "firebase-service-account.json");
  if (explicitCredentials) {
    initializeApp({ credential: applicationDefault(), projectId });
    return;
  }
  if (existsSync(localServiceAccountPath)) {
    const serviceAccount = JSON.parse(readFileSync(localServiceAccountPath, "utf8")) as ServiceAccount;
    if (serviceAccount.projectId && serviceAccount.projectId !== projectId) {
      throw new Error(
        `service account project(${serviceAccount.projectId})と指定project(${projectId})が一致しません`,
      );
    }
    initializeApp({ credential: cert(serviceAccount), projectId });
    return;
  }
  initializeApp({ credential: applicationDefault(), projectId });
}

function assertConnectedProject(projectId: string): void {
  const connectedProjectId = getApps()[0]?.options.projectId;
  if (connectedProjectId !== projectId) {
    throw new Error(`Firebase接続先(${connectedProjectId})と指定project(${projectId})が一致しません`);
  }
}

function snapshotMap(snapshot: { docs: Array<{ id: string; data: () => DocumentData }> }): Record<string, string> {
  return sortedRecord(Object.fromEntries(
    snapshot.docs.map((document) => [document.id, stableSnapshot(document.data())]),
  ));
}

function sortedRecord(values: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(values).sort(([left], [right]) => left.localeCompare(right)));
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function nullableStringValue(value: unknown): string | null {
  return stringValue(value) || null;
}

function errorSummary(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 1_000);
}
