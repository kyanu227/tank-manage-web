/**
 * タンク操作の一元化モジュール
 *
 * タンク操作ログは追記型 revision チェーンで管理する。
 * ログ本文は直接上書きせず、編集時は旧 revision を superseded にして
 * 新しい active revision を作成する。
 */

import {
  collection,
  deleteField,
  doc,
  runTransaction,
  serverTimestamp,
  type DocumentData,
  type DocumentReference,
  type Transaction,
} from "firebase/firestore";
import { db } from "./firebase/config";
import {
  ACTION,
  getNextStatus,
  validateTransition,
  type TankAction,
} from "./tank-rules";
import type {
  CustomerSnapshot,
  OperationActor,
  OperationContext,
} from "./operation-context";

/* ════════════════════════════════════════════
   型定義
   ════════════════════════════════════════════ */

export type TankSnapshot = {
  status: string;
  location?: string;
  staff?: string;
  logNote?: string;
};

export interface TankOperationInput {
  /** タンク ID */
  tankId: string;

  /** 遷移ルールを決める action（OP_RULES のキー） */
  transitionAction: TankAction;

  /** ログに記録する操作名。省略時は transitionAction と同じ。 */
  logAction?: string;

  /** UI 側の参考値。実際の検証は transaction 内で読んだ tanks の現在値で行う。 */
  currentStatus?: string;

  /** 操作者・顧客 snapshot。logs の identity field はここから正規化する。 */
  context: OperationContext;

  /** 遷移後の場所。省略時は "倉庫" */
  location?: string;

  /** タンクドキュメントに記録する logNote（タグ情報など）。省略時は空。 */
  tankNote?: string;

  /** ログドキュメントに記録する note（自由メモ）。省略時は空。 */
  logNote?: string;

  /** ログに追加したい任意フィールド（transactionId などの業務メタ情報） */
  logExtra?: Record<string, unknown>;

  /** タンクドキュメントに追加したい任意フィールド */
  tankExtra?: Record<string, unknown>;

  /** バリデーションをスキップする（旧データ救済など特殊ケース用） */
  skipValidation?: boolean;
}

export interface TankOperationResult {
  tankId: string;
  nextStatus: string;
  logRef: DocumentReference;
  tankRef: DocumentReference;
}

export type TankOperationWriter = {
  set: (reference: DocumentReference, data: DocumentData, options?: unknown) => unknown;
  update: (reference: DocumentReference, data: DocumentData) => unknown;
  delete: (reference: DocumentReference) => unknown;
};

export type StaffCorrectionRole = "管理者" | "準管理者" | "一般";

export type LogCorrectionPatch = {
  tankId?: string;
  transitionAction?: TankAction;
  logAction?: string;
  location?: string;
  customer?: CustomerSnapshot | null;
  note?: string;
  logNote?: string;
};

export interface ApplyLogCorrectionInput {
  targetLogId: string;
  mode: "replace" | "revert";
  sourceLogId?: string;
  patch?: LogCorrectionPatch;
  reason: string;
  editor: OperationActor;
  editedByRole?: StaffCorrectionRole;
}

export interface VoidLogInput {
  logId: string;
  voider: OperationActor;
  voidedByRole?: StaffCorrectionRole;
  reason: string;
}

type TankLogData = DocumentData & {
  tankId?: unknown;
  action?: unknown;
  transitionAction?: unknown;
  location?: unknown;
  staffId?: unknown;
  staffName?: unknown;
  staffEmail?: unknown;
  customerId?: unknown;
  customerName?: unknown;
  note?: unknown;
  logNote?: unknown;
  logStatus?: unknown;
  logKind?: unknown;
  rootLogId?: unknown;
  revision?: unknown;
  supersededByLogId?: unknown;
  originalAt?: unknown;
  revisionCreatedAt?: unknown;
  timestamp?: unknown;
  prevTankSnapshot?: unknown;
  nextTankSnapshot?: unknown;
  previousLogIdOnSameTank?: unknown;
};

type TankLogContent = {
  tankId: string;
  action: string;
  transitionAction: TankAction;
  location: string;
  staffId: string;
  staffName: string;
  staffEmail?: string;
  customerId?: string;
  customerName?: string;
  note: string;
  logNote: string;
  extraFields: Record<string, unknown>;
};

type PlannedTankOperation = {
  input: TankOperationInput;
  logRef: DocumentReference;
  tankRef: DocumentReference;
};

const META_LOG_FIELDS = new Set([
  "logStatus",
  "logKind",
  "rootLogId",
  "revision",
  "supersedesLogId",
  "supersededByLogId",
  "originalAt",
  "revisionCreatedAt",
  "timestamp",
  "editedBy",
  "editedByStaffId",
  "editedByStaffName",
  "editedByStaffEmail",
  "editReason",
  "prevTankSnapshot",
  "nextTankSnapshot",
  "previousLogIdOnSameTank",
  "voidReason",
  "voidedAt",
  "voidedBy",
  "voidedByStaffId",
  "voidedByStaffName",
  "voidedByStaffEmail",
  "voided",
  "prevStatus",
  "newStatus",
]);

const PRIVILEGED_CORRECTION_ROLES: StaffCorrectionRole[] = ["管理者", "準管理者"];
const CORRECTION_LIMIT_MS = 72 * 60 * 60 * 1000;

/* ════════════════════════════════════════════
   新規ログ作成
   ════════════════════════════════════════════ */

/**
 * 単一タンク操作を追記型ログとして transaction で作成する。
 *
 * 旧 batch 型の append 経路は廃止し、外部から read なしでログだけを積めないようにする。
 */
export async function appendTankOperation(
  input: TankOperationInput
): Promise<TankOperationResult & { logId: string }> {
  return applyTankOperation(input);
}

/**
 * 単一タンクの操作を原子的に実行する。
 */
export async function applyTankOperation(
  input: TankOperationInput
): Promise<TankOperationResult & { logId: string }> {
  const logRef = doc(collection(db, "logs"));
  const tankRef = doc(db, "tanks", normalizeTankId(input.tankId));
  const planned: PlannedTankOperation = {
    input: { ...input, tankId: normalizeTankId(input.tankId) },
    logRef,
    tankRef,
  };

  const result = await runTransaction(db, async (tx) => {
    const [operationResult] = await commitPlannedOperations(tx, [planned]);
    return operationResult;
  });

  return { ...result, logId: logRef.id };
}

/**
 * 複数タンクの操作を一括実行する。
 * 追加書き込みは transaction writer の set/update/delete だけに寄せる。
 */
export async function applyBulkTankOperations(
  inputs: TankOperationInput[],
  extraOps?: (writer: TankOperationWriter) => void
): Promise<TankOperationResult[]> {
  if (inputs.length === 0) return [];

  assertNoDuplicateTankIds(inputs);

  const planned = inputs.map((input) => {
    const tankId = normalizeTankId(input.tankId);
    return {
      input: { ...input, tankId },
      logRef: doc(collection(db, "logs")),
      tankRef: doc(db, "tanks", tankId),
    };
  });

  return runTransaction(db, async (tx) => {
    const results = await commitPlannedOperations(tx, planned);
    if (extraOps) extraOps(tx as unknown as TankOperationWriter);
    return results;
  });
}

async function commitPlannedOperations(
  tx: Transaction,
  planned: PlannedTankOperation[]
): Promise<TankOperationResult[]> {
  const tankSnaps = await Promise.all(planned.map((op) => tx.get(op.tankRef)));

  const results: TankOperationResult[] = [];

  planned.forEach((op, index) => {
    const tankSnap = tankSnaps[index];
    if (!tankSnap.exists()) {
      throw new Error(`[${op.input.tankId}] タンクが存在しません`);
    }

    const tankData = tankSnap.data();
    const prevSnapshot = snapshotFromTankData(tankData);

    if (!op.input.skipValidation) {
      const v = validateTransition(prevSnapshot.status, op.input.transitionAction);
      if (!v.ok) {
        throw new Error(`[${op.input.tankId}] ${v.reason}`);
      }
    }

    const nextStatus = getNextStatus(op.input.transitionAction);
    const location = op.input.location ?? "倉庫";
    const tankLogNote = op.input.tankNote ?? "";
    const logNote = op.input.logNote ?? "";
    const logAction = op.input.logAction ?? op.input.transitionAction;
    const actor = op.input.context.actor;
    const nextSnapshot: TankSnapshot = {
      status: nextStatus,
      location,
      staff: actor.staffName,
      logNote: tankLogNote,
    };
    const now = serverTimestamp();

    tx.set(op.logRef, {
      ...(op.input.logExtra ?? {}),
      tankId: op.input.tankId,
      action: logAction,
      transitionAction: op.input.transitionAction,
      prevStatus: prevSnapshot.status,
      newStatus: nextStatus,
      location,
      ...operationIdentityFields(op.input.context),
      note: logNote,
      logNote: tankLogNote,
      timestamp: now,
      originalAt: now,
      revisionCreatedAt: now,
      logStatus: "active",
      logKind: "tank",
      rootLogId: op.logRef.id,
      revision: 1,
      prevTankSnapshot: prevSnapshot,
      nextTankSnapshot: nextSnapshot,
      previousLogIdOnSameTank: stringOrNull(tankData.latestLogId),
    });

    tx.update(op.tankRef, {
      ...tankUpdateFromSnapshot(nextSnapshot, op.logRef.id),
      ...(op.input.tankExtra ?? {}),
    });

    results.push({
      tankId: op.input.tankId,
      nextStatus,
      logRef: op.logRef,
      tankRef: op.tankRef,
    });
  });

  return results;
}

/* ════════════════════════════════════════════
   編集・編集取消
   ════════════════════════════════════════════ */

export async function applyLogCorrection(
  input: ApplyLogCorrectionInput
): Promise<{ logId: string }> {
  const reason = input.reason.trim();
  if (reason.length < 5) {
    throw new Error("理由は5文字以上で入力してください");
  }
  if (input.mode === "revert" && !input.sourceLogId) {
    throw new Error("復元元ログが指定されていません");
  }

  const targetRef = doc(db, "logs", input.targetLogId);
  const newLogRef = doc(collection(db, "logs"));

  await runTransaction(db, async (tx) => {
    const targetSnap = await tx.get(targetRef);
    if (!targetSnap.exists()) {
      throw new Error("対象ログが存在しません");
    }

    const oldLog = targetSnap.data() as TankLogData;
    assertActiveTankLog(oldLog);
    if (oldLog.supersededByLogId) {
      throw new Error("このログはすでに置換されています");
    }

    const oldTankId = requireString(oldLog.tankId, "対象ログのtankId");
    const oldTankRef = doc(db, "tanks", oldTankId);
    const oldTankSnap = await tx.get(oldTankRef);
    if (!oldTankSnap.exists()) {
      throw new Error(`[${oldTankId}] タンクが存在しません`);
    }
    const oldTankData = oldTankSnap.data();
    if (stringOrNull(oldTankData.latestLogId) !== input.targetLogId) {
      throw new Error("最新の有効ログだけ編集できます");
    }

    enforceCorrectionWindow(oldLog, input.editedByRole);

    let sourceLog: TankLogData | null = null;
    if (input.mode === "revert") {
      const sourceRef = doc(db, "logs", input.sourceLogId!);
      const sourceSnap = await tx.get(sourceRef);
      if (!sourceSnap.exists()) {
        throw new Error("復元元ログが存在しません");
      }
      sourceLog = sourceSnap.data() as TankLogData;
      if (sourceLog.logKind !== "tank") {
        throw new Error("タンク操作ログだけ復元できます");
      }
      if (sourceLog.logStatus === "voided") {
        throw new Error("取消済み revision には戻せません");
      }
      if (requireString(sourceLog.rootLogId, "復元元ログのrootLogId") !== requireString(oldLog.rootLogId, "対象ログのrootLogId")) {
        throw new Error("同一チェーン内のログだけ復元できます");
      }
    }

    const content = input.mode === "revert" && sourceLog
      ? tankLogContentFromSource(sourceLog)
      : mergeTankLogContent(oldLog, input.patch ?? {});
    const newTankId = normalizeTankId(content.tankId);
    const sameTank = newTankId === oldTankId;

    const newTankRef = sameTank ? oldTankRef : doc(db, "tanks", newTankId);
    const newTankSnap = sameTank ? oldTankSnap : await tx.get(newTankRef);
    if (!newTankSnap.exists()) {
      throw new Error(`[${newTankId}] タンクが存在しません`);
    }

    const prevSnapshot = sameTank
      ? requireTankSnapshot(oldLog.prevTankSnapshot, "対象ログのprevTankSnapshot")
      : snapshotFromTankData(newTankSnap.data());

    const v = validateTransition(prevSnapshot.status, content.transitionAction);
    if (!v.ok) {
      throw new Error(`[${newTankId}] ${v.reason}`);
    }

    const nextSnapshot = nextSnapshotFromContent(prevSnapshot, content);
    const revision = requireNumber(oldLog.revision, "対象ログのrevision") + 1;
    const rootLogId = requireString(oldLog.rootLogId, "対象ログのrootLogId");
    const originalAt = oldLog.originalAt ?? oldLog.timestamp;
    if (!originalAt) {
      throw new Error("対象ログのoriginalAtがありません");
    }
    const inheritedTimestamp = oldLog.timestamp ?? oldLog.originalAt;
    if (!inheritedTimestamp) {
      throw new Error("対象ログのtimestampがありません");
    }

    tx.update(targetRef, {
      logStatus: "superseded",
      supersededByLogId: newLogRef.id,
    });

    tx.set(newLogRef, {
      ...content.extraFields,
      tankId: newTankId,
      action: content.action,
      transitionAction: content.transitionAction,
      location: content.location,
      ...tankLogContentIdentityFields(content),
      note: content.note,
      logNote: content.logNote,
      prevStatus: prevSnapshot.status,
      newStatus: nextSnapshot.status,
      logStatus: "active",
      logKind: "tank",
      rootLogId,
      revision,
      supersedesLogId: input.targetLogId,
      originalAt,
      timestamp: inheritedTimestamp,
      revisionCreatedAt: serverTimestamp(),
      ...editorAuditFields(input.editor),
      editReason: reason,
      prevTankSnapshot: prevSnapshot,
      nextTankSnapshot: nextSnapshot,
      previousLogIdOnSameTank: sameTank
        ? stringOrNull(oldLog.previousLogIdOnSameTank)
        : stringOrNull(newTankSnap.data().latestLogId),
    });

    if (!sameTank) {
      const oldPrevSnapshot = requireTankSnapshot(oldLog.prevTankSnapshot, "対象ログのprevTankSnapshot");
      tx.update(oldTankRef, tankUpdateFromSnapshot(oldPrevSnapshot, stringOrNull(oldLog.previousLogIdOnSameTank)));
    }
    tx.update(newTankRef, tankUpdateFromSnapshot(nextSnapshot, newLogRef.id));
  });

  return { logId: newLogRef.id };
}

/* ════════════════════════════════════════════
   取消
   ════════════════════════════════════════════ */

export async function voidLog(input: VoidLogInput): Promise<void> {
  const reason = input.reason.trim();
  if (reason.length < 5) {
    throw new Error("理由は5文字以上で入力してください");
  }

  const logRef = doc(db, "logs", input.logId);

  await runTransaction(db, async (tx) => {
    const logSnap = await tx.get(logRef);
    if (!logSnap.exists()) {
      throw new Error("対象ログが存在しません");
    }

    const log = logSnap.data() as TankLogData;
    assertActiveTankLog(log);
    enforceCorrectionWindow(log, input.voidedByRole);

    const tankId = requireString(log.tankId, "対象ログのtankId");
    const tankRef = doc(db, "tanks", tankId);
    const tankSnap = await tx.get(tankRef);
    if (!tankSnap.exists()) {
      throw new Error(`[${tankId}] タンクが存在しません`);
    }
    if (stringOrNull(tankSnap.data().latestLogId) !== input.logId) {
      throw new Error("最新の有効ログだけ取消できます");
    }

    const prevSnapshot = requireTankSnapshot(log.prevTankSnapshot, "対象ログのprevTankSnapshot");
    tx.update(logRef, {
      logStatus: "voided",
      voidReason: reason,
      voidedAt: serverTimestamp(),
      ...voiderAuditFields(input.voider),
    });
    tx.update(tankRef, tankUpdateFromSnapshot(prevSnapshot, stringOrNull(log.previousLogIdOnSameTank)));
  });
}

/* ════════════════════════════════════════════
   ヘルパー
   ════════════════════════════════════════════ */

function normalizeTankId(tankId: string): string {
  return tankId.trim().toUpperCase();
}

function snapshotFromTankData(data: DocumentData): TankSnapshot {
  const snapshot: TankSnapshot = {
    status: String(data.status ?? ""),
  };
  if (data.location != null) snapshot.location = String(data.location);
  if (data.staff != null) snapshot.staff = String(data.staff);
  if (data.logNote != null) snapshot.logNote = String(data.logNote);
  return snapshot;
}

function tankUpdateFromSnapshot(
  snapshot: TankSnapshot,
  latestLogId: string | null
): DocumentData {
  return {
    status: snapshot.status,
    location: snapshot.location ?? deleteField(),
    staff: snapshot.staff ?? deleteField(),
    logNote: snapshot.logNote ?? deleteField(),
    latestLogId,
    updatedAt: serverTimestamp(),
  };
}

function operationIdentityFields(context: OperationContext): DocumentData {
  const actor = context.actor;
  return {
    staffId: actor.staffId,
    staffName: actor.staffName,
    ...(actor.staffEmail ? { staffEmail: actor.staffEmail } : {}),
    ...(context.customer
      ? {
          customerId: context.customer.customerId,
          customerName: context.customer.customerName,
        }
      : {}),
  };
}

function tankLogContentIdentityFields(content: TankLogContent): DocumentData {
  return {
    staffId: content.staffId,
    staffName: content.staffName,
    ...(content.staffEmail ? { staffEmail: content.staffEmail } : {}),
    ...(content.customerId && content.customerName
      ? { customerId: content.customerId, customerName: content.customerName }
      : {}),
  };
}

function tankLogIdentityFromLog(log: TankLogData, label: string): OperationContext {
  const staffEmail = stringOrUndefined(log.staffEmail);
  const actor: OperationActor = {
    staffId: requireString(log.staffId, `${label}のstaffId`),
    staffName: requireString(log.staffName, `${label}のstaffName`),
    ...(staffEmail ? { staffEmail } : {}),
  };

  const customerId = stringOrUndefined(log.customerId);
  const customerName = stringOrUndefined(log.customerName);
  if (customerId || customerName) {
    if (!customerId) throw new Error(`${label}のcustomerIdがありません`);
    if (!customerName) throw new Error(`${label}のcustomerNameがありません`);
    return { actor, customer: { customerId, customerName } };
  }

  return { actor };
}

function editorAuditFields(actor: OperationActor): DocumentData {
  return {
    editedByStaffId: actor.staffId,
    editedByStaffName: actor.staffName,
    ...(actor.staffEmail ? { editedByStaffEmail: actor.staffEmail } : {}),
  };
}

function voiderAuditFields(actor: OperationActor): DocumentData {
  return {
    voidedByStaffId: actor.staffId,
    voidedByStaffName: actor.staffName,
    ...(actor.staffEmail ? { voidedByStaffEmail: actor.staffEmail } : {}),
  };
}

function nextSnapshotFromContent(
  prevSnapshot: TankSnapshot,
  content: TankLogContent
): TankSnapshot {
  return {
    ...prevSnapshot,
    status: getNextStatus(content.transitionAction),
    location: content.location,
    staff: content.staffName,
    logNote: content.logNote,
  };
}

function mergeTankLogContent(oldLog: TankLogData, patch: LogCorrectionPatch): TankLogContent {
  const oldTransitionAction = requireTankAction(
    oldLog.transitionAction ?? oldLog.action,
    "対象ログのtransitionAction"
  );
  const transitionAction = patch.transitionAction ?? oldTransitionAction;
  const transitionChanged = patch.transitionAction !== undefined && patch.transitionAction !== oldTransitionAction;
  const action = patch.logAction ?? (transitionChanged ? transitionAction : stringOrDefault(oldLog.action, transitionAction));
  const tankId = patch.tankId != null ? normalizeTankId(patch.tankId) : requireString(oldLog.tankId, "対象ログのtankId");
  const identity = tankLogIdentityFromLog(oldLog, "対象ログ");
  const customer =
    patch.customer === undefined
      ? identity.customer
      : patch.customer ?? undefined;

  return {
    tankId,
    action,
    transitionAction,
    location: patch.location ?? stringOrDefault(oldLog.location, "倉庫"),
    staffId: identity.actor.staffId,
    staffName: identity.actor.staffName,
    ...(identity.actor.staffEmail ? { staffEmail: identity.actor.staffEmail } : {}),
    ...(customer
      ? { customerId: customer.customerId, customerName: customer.customerName }
      : {}),
    note: patch.note ?? stringOrDefault(oldLog.note, ""),
    logNote: patch.logNote ?? stringOrDefault(oldLog.logNote, ""),
    extraFields: copyBodyExtraFields(oldLog),
  };
}

function tankLogContentFromSource(sourceLog: TankLogData): TankLogContent {
  const transitionAction = requireTankAction(
    sourceLog.transitionAction ?? sourceLog.action,
    "復元元ログのtransitionAction"
  );
  const identity = tankLogIdentityFromLog(sourceLog, "復元元ログ");
  return {
    tankId: requireString(sourceLog.tankId, "復元元ログのtankId"),
    action: stringOrDefault(sourceLog.action, transitionAction),
    transitionAction,
    location: stringOrDefault(sourceLog.location, "倉庫"),
    staffId: identity.actor.staffId,
    staffName: identity.actor.staffName,
    ...(identity.actor.staffEmail ? { staffEmail: identity.actor.staffEmail } : {}),
    ...(identity.customer
      ? { customerId: identity.customer.customerId, customerName: identity.customer.customerName }
      : {}),
    note: stringOrDefault(sourceLog.note, ""),
    logNote: stringOrDefault(sourceLog.logNote, ""),
    extraFields: copyBodyExtraFields(sourceLog),
  };
}

function copyBodyExtraFields(log: TankLogData): Record<string, unknown> {
  const extra: Record<string, unknown> = {};
  Object.entries(log).forEach(([key, value]) => {
    if (!META_LOG_FIELDS.has(key)) extra[key] = value;
  });
  delete extra.tankId;
  delete extra.action;
  delete extra.transitionAction;
  delete extra.location;
  delete extra.staff;
  delete extra.staffId;
  delete extra.staffName;
  delete extra.staffEmail;
  delete extra.customerId;
  delete extra.customerName;
  delete extra.note;
  delete extra.logNote;
  return extra;
}

function assertActiveTankLog(log: TankLogData): void {
  if (log.logKind !== "tank") {
    throw new Error("タンク操作ログだけ編集・取消できます");
  }
  if (log.logStatus !== "active") {
    throw new Error("有効なログだけ編集・取消できます");
  }
}

function enforceCorrectionWindow(log: TankLogData, role: StaffCorrectionRole | undefined): void {
  const effectiveRole = role ?? "一般";
  if (PRIVILEGED_CORRECTION_ROLES.includes(effectiveRole)) return;

  const createdAt = timestampToMillis(log.revisionCreatedAt);
  if (createdAt == null) {
    throw new Error("対象ログの作成日時を確認できません");
  }
  if (Date.now() - createdAt > CORRECTION_LIMIT_MS) {
    throw new Error("一般スタッフは72時間を過ぎたログを編集・取消できません");
  }
}

function timestampToMillis(value: unknown): number | null {
  if (!value) return null;
  if (typeof value === "number") return value;
  if (value instanceof Date) return value.getTime();
  if (typeof (value as { toMillis?: unknown }).toMillis === "function") {
    return (value as { toMillis: () => number }).toMillis();
  }
  if (typeof (value as { toDate?: unknown }).toDate === "function") {
    return (value as { toDate: () => Date }).toDate().getTime();
  }
  return null;
}

function requireTankSnapshot(value: unknown, label: string): TankSnapshot {
  if (!value || typeof value !== "object") {
    throw new Error(`${label}がありません`);
  }
  const raw = value as Record<string, unknown>;
  return {
    status: requireString(raw.status, `${label}.status`),
    ...(raw.location != null ? { location: String(raw.location) } : {}),
    ...(raw.staff != null ? { staff: String(raw.staff) } : {}),
    ...(raw.logNote != null ? { logNote: String(raw.logNote) } : {}),
  };
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label}がありません`);
  }
  return value;
}

function requireNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label}がありません`);
  }
  return value;
}

function stringOrDefault(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function stringOrUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function requireTankAction(value: unknown, label: string): TankAction {
  if (typeof value !== "string" || !Object.values(ACTION).includes(value as TankAction)) {
    throw new Error(`${label}が不正です`);
  }
  return value as TankAction;
}

function assertNoDuplicateTankIds(inputs: TankOperationInput[]): void {
  const seen = new Set<string>();
  for (const input of inputs) {
    const tankId = normalizeTankId(input.tankId);
    if (seen.has(tankId)) {
      throw new Error(`[${tankId}] 同一タンクへの複数操作は一括処理できません`);
    }
    seen.add(tankId);
  }
}
