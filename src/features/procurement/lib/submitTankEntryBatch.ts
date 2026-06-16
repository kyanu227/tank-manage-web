"use client";

import {
  collection,
  doc,
  runTransaction,
  serverTimestamp,
  type DocumentData,
} from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import type { OperationActor } from "@/lib/operation-context";
import {
  coerceTankStatusCode,
  type TankStatusCode,
} from "@/lib/tank-action-status-codes";
import { normalizeTankId } from "@/lib/tank-id";

export type TankEntryMode = "purchase" | "register";

export interface SubmitTankEntryBatchInput {
  mode: TankEntryMode;
  tankIds: string[];
  tankType: string;
  initialStatus: TankStatusCode;
  location: string;
  note?: string;
  nextMaintenanceDate?: string;
  purchaseDate?: string;
  vendor?: string;
  unitCost?: number;
  actor: OperationActor;
}

export interface SubmitTankEntryBatchResult {
  count: number;
  totalCost: number;
}

type NormalizedTankEntryBatch = {
  mode: TankEntryMode;
  tankIds: string[];
  tankType: string;
  initialStatus: TankStatusCode;
  location: string;
  note: string;
  nextMaintenanceDate?: string;
  purchaseDate?: string;
  vendor?: string;
  unitCost: number;
  totalCost: number;
  actor: OperationActor;
};

export async function submitTankEntryBatch(
  input: SubmitTankEntryBatchInput
): Promise<SubmitTankEntryBatchResult> {
  const batchInput = normalizeTankEntryBatch(input);
  validateTankEntryBatch(batchInput);

  const procurementRef = doc(collection(db, "tankProcurements"));
  const logRef = doc(collection(db, "logs"));

  // procurement は初期登録・購入記録であり、通常の tank operation 状態遷移とは分けて直接作成する。
  await runTransaction(db, async (tx) => {
    for (const tankId of batchInput.tankIds) {
      const tankRef = doc(db, "tanks", tankId);
      const tankSnap = await tx.get(tankRef);
      if (tankSnap.exists()) {
        throw new Error(`${tankId} は既に登録されています`);
      }
    }

    for (const tankId of batchInput.tankIds) {
      const tankRef = doc(db, "tanks", tankId);
      tx.set(tankRef, buildTankCreationPayload(batchInput));
    }

    tx.set(procurementRef, buildTankProcurementPayload(batchInput, logRef.id));
    tx.set(logRef, buildProcurementLogPayload(batchInput, procurementRef.id));
  });

  return { count: batchInput.tankIds.length, totalCost: batchInput.totalCost };
}

function normalizeTankEntryBatch(input: SubmitTankEntryBatchInput): NormalizedTankEntryBatch {
  const tankIds = uniqueTankIds(input.tankIds);
  const tankType = String(input.tankType || "").trim();
  const location = String(input.location || "").trim();
  const note = String(input.note || "").trim();
  const initialStatus = requireInitialTankStatusCode(input.initialStatus);
  const actor = normalizeActor(input.actor);
  const nextMaintenanceDate = normalizeDateYmd(input.nextMaintenanceDate);
  const purchaseDate = normalizeDateYmd(input.purchaseDate);
  const vendor = String(input.vendor || "").trim();
  const unitCost = input.mode === "purchase" ? Number(input.unitCost) || 0 : 0;
  const totalCost = unitCost * tankIds.length;

  return {
    mode: input.mode,
    tankIds,
    tankType,
    initialStatus,
    location,
    note,
    ...(nextMaintenanceDate ? { nextMaintenanceDate } : {}),
    ...(purchaseDate ? { purchaseDate } : {}),
    ...(vendor ? { vendor } : {}),
    unitCost,
    totalCost,
    actor,
  };
}

function validateTankEntryBatch(input: NormalizedTankEntryBatch): void {
  if (input.tankIds.length === 0) throw new Error("タンクIDを1件以上追加してください");
  if (!input.tankType) throw new Error("タンク種別を選択してください");
  if (!input.location) throw new Error("保管場所を選択してください");
  if (input.mode === "purchase" && input.unitCost <= 0) {
    throw new Error("購入単価を入力してください");
  }
}

function requireInitialTankStatusCode(status: string | null | undefined): TankStatusCode {
  const code = coerceTankStatusCode(status);
  if (!code) {
    throw new Error("初期ステータスが不正です");
  }
  return code;
}

function buildTankCreationPayload(input: NormalizedTankEntryBatch): DocumentData {
  return {
    status: input.initialStatus,
    location: input.location,
    type: input.tankType,
    ...(input.note ? { note: input.note } : {}),
    ...(input.nextMaintenanceDate ? { nextMaintenanceDate: input.nextMaintenanceDate } : {}),
    updatedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
  };
}

function buildTankProcurementPayload(
  input: NormalizedTankEntryBatch,
  logId: string,
): DocumentData {
  return {
    kind: input.mode,
    tankIds: input.tankIds,
    itemCount: input.tankIds.length,
    tankType: input.tankType,
    initialStatus: input.initialStatus,
    location: input.location,
    note: input.note,
    ...(input.nextMaintenanceDate ? { nextMaintenanceDate: input.nextMaintenanceDate } : {}),
    ...(input.purchaseDate ? { purchaseDate: input.purchaseDate } : {}),
    ...(input.vendor ? { vendor: input.vendor } : {}),
    unitCost: input.unitCost,
    totalCost: input.totalCost,
    logId,
    staff: input.actor.staffName,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
}

function buildProcurementLogPayload(
  input: NormalizedTankEntryBatch,
  procurementId: string,
): DocumentData {
  return {
    tankId: summarizeTankIds(input.tankIds),
    action: input.mode === "purchase" ? "タンク購入" : "タンク登録",
    newStatus: input.initialStatus,
    location: input.location,
    staffId: input.actor.staffId,
    staffName: input.actor.staffName,
    ...(input.actor.staffEmail ? { staffEmail: input.actor.staffEmail } : {}),
    note: buildLogNote(input),
    logStatus: "active",
    logKind: "procurement",
    procurementId,
    timestamp: serverTimestamp(),
  };
}

function normalizeActor(actor: OperationActor): OperationActor {
  const staffId = String(actor?.staffId || "").trim();
  const staffName = String(actor?.staffName || "").trim();
  const staffEmail = String(actor?.staffEmail || "").trim();

  if (!staffId || !staffName) {
    throw new Error("操作者を取得できませんでした");
  }

  return {
    staffId,
    staffName,
    ...(staffEmail ? { staffEmail } : {}),
  };
}

function uniqueTankIds(values: string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  values.forEach((value) => {
    if (!String(value || "").trim()) return;
    const normalized = normalizeTankId(value);
    if (seen.has(normalized)) return;
    seen.add(normalized);
    result.push(normalized);
  });

  return result;
}

function normalizeDateYmd(value?: string): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.replace(/-/g, "/");
}

function summarizeTankIds(tankIds: string[]): string {
  if (tankIds.length === 1) return tankIds[0];
  return `${tankIds[0]} 他${tankIds.length - 1}本`;
}

function buildLogNote({
  tankIds,
  tankType,
  note,
  totalCost,
  mode,
}: {
  tankIds: string[];
  tankType: string;
  note: string;
  totalCost: number;
  mode: TankEntryMode;
}): string {
  const lines = [
    `種別: ${tankType}`,
    `ID: ${tankIds.join(", ")}`,
  ];

  if (mode === "purchase") {
    lines.push(`費用: ¥${totalCost.toLocaleString()}`);
  }
  if (note) {
    lines.push(`メモ: ${note}`);
  }

  return lines.join(" / ");
}
