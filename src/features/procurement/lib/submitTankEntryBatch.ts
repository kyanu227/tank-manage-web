"use client";

import {
  collection,
  doc,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import type { OperationActor } from "@/lib/operation-context";

export type TankEntryMode = "purchase" | "register";

export interface SubmitTankEntryBatchInput {
  mode: TankEntryMode;
  tankIds: string[];
  tankType: string;
  initialStatus: string;
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

export async function submitTankEntryBatch(
  input: SubmitTankEntryBatchInput
): Promise<SubmitTankEntryBatchResult> {
  const tankIds = uniqueTankIds(input.tankIds);
  const tankType = String(input.tankType || "").trim();
  const location = String(input.location || "").trim();
  const note = String(input.note || "").trim();
  const actor = normalizeActor(input.actor);
  const nextMaintenanceDate = normalizeDateYmd(input.nextMaintenanceDate);
  const purchaseDate = normalizeDateYmd(input.purchaseDate);
  const unitCost = input.mode === "purchase" ? Number(input.unitCost) || 0 : 0;
  const totalCost = unitCost * tankIds.length;

  if (tankIds.length === 0) throw new Error("タンクIDを1件以上追加してください");
  if (!tankType) throw new Error("タンク種別を選択してください");
  if (!location) throw new Error("保管場所を選択してください");
  if (input.mode === "purchase" && unitCost <= 0) {
    throw new Error("購入単価を入力してください");
  }

  const procurementRef = doc(collection(db, "tankProcurements"));
  const logRef = doc(collection(db, "logs"));

  await runTransaction(db, async (tx) => {
    for (const tankId of tankIds) {
      const tankRef = doc(db, "tanks", tankId);
      const tankSnap = await tx.get(tankRef);
      if (tankSnap.exists()) {
        throw new Error(`${tankId} は既に登録されています`);
      }
    }

    for (const tankId of tankIds) {
      const tankRef = doc(db, "tanks", tankId);
      tx.set(tankRef, {
        status: input.initialStatus,
        location,
        type: tankType,
        ...(note ? { note } : {}),
        ...(nextMaintenanceDate ? { nextMaintenanceDate } : {}),
        updatedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
      });
    }

    tx.set(procurementRef, {
      kind: input.mode,
      tankIds,
      itemCount: tankIds.length,
      tankType,
      initialStatus: input.initialStatus,
      location,
      note,
      ...(nextMaintenanceDate ? { nextMaintenanceDate } : {}),
      ...(purchaseDate ? { purchaseDate } : {}),
      ...(input.vendor?.trim() ? { vendor: input.vendor.trim() } : {}),
      unitCost,
      totalCost,
      logId: logRef.id,
      staff: actor.staffName,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    tx.set(logRef, {
      tankId: summarizeTankIds(tankIds),
      action: input.mode === "purchase" ? "タンク購入" : "タンク登録",
      newStatus: input.initialStatus,
      location,
      staffId: actor.staffId,
      staffName: actor.staffName,
      ...(actor.staffEmail ? { staffEmail: actor.staffEmail } : {}),
      note: buildLogNote({
        tankIds,
        tankType,
        note,
        totalCost,
        mode: input.mode,
      }),
      logStatus: "active",
      logKind: "procurement",
      procurementId: procurementRef.id,
      timestamp: serverTimestamp(),
    });
  });

  return { count: tankIds.length, totalCost };
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

function normalizeTankId(tankId: string): string {
  return tankId
    .trim()
    .toUpperCase()
    .replace(/[‐‑‒–—―ーｰ−]/g, "-")
    .replace(/\s+/g, "");
}

function uniqueTankIds(values: string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  values.forEach((value) => {
    const normalized = normalizeTankId(value);
    if (!normalized) return;
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
