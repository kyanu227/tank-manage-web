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
  getNextStatusCode,
  validateTransitionCode,
  type TankAction,
} from "./tank-rules";
import {
  normalizeTankActionCode,
  normalizeTankStatusCode,
  tankActionCodeToLegacyAction,
  tankActionToCode,
  tankStatusCodeToLegacyStatus,
  tankStatusToCode,
  type TankActionCode,
  type TankStatusCode,
} from "./tank-action-status-codes";
import type {
  CustomerSnapshot,
  OperationActor,
  OperationContext,
} from "./operation-context";

/* ════════════════════════════════════════════
   型定義
   ════════════════════════════════════════════ */

export type TankSnapshot = {
  status: TankStatusCode;
  /** 現在貸出先の customers/{customerId} projection。undefined は legacy/未導入、null は顧客なしの明示値。 */
  customerId?: string | null;
  /** 現在貸出先の表示 snapshot。undefined は legacy/未導入、null は顧客なしの明示値。 */
  customerName?: string | null;
  location?: string;
  staff?: string;
  logNote?: string;
};

type TankCustomerProjection = Pick<TankSnapshot, "customerId" | "customerName">;
type CustomerProjectionResolveMode = "operation" | "revision";

export interface TankOperationInput {
  /** タンク ID */
  tankId: string;

  /** 遷移ルールを決める action（OP_RULES のキー） */
  transitionAction: TankAction | TankActionCode;

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

  /** ログに追加したい補助フィールド。正本 typed field は context に置く。 */
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
  transitionAction?: TankAction | TankActionCode;
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
  action: TankActionCode;
  transitionAction: TankActionCode;
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

const RESERVED_LOG_EXTRA_FIELDS = new Set([
  ...META_LOG_FIELDS,
  "tankId",
  "action",
  "transitionAction",
  "location",
  "staff",
  "customer",
  "staffId",
  "staffName",
  "staffEmail",
  "customerId",
  "customerName",
  "transactionId",
  "source",
  "workflow",
  "returnCondition",
  "note",
  "logNote",
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
    const transitionAction = requireTankActionCode(
      op.input.transitionAction,
      `[${op.input.tankId}] transitionAction`
    );

    if (!op.input.skipValidation) {
      if (!validateTransitionCode(prevSnapshot.status, transitionAction)) {
        throw new Error(
          `[${op.input.tankId}] ${transitionFailureReason(prevSnapshot.status, transitionAction)}`
        );
      }
    }

    const nextStatus = requireNextStatusCode(transitionAction, `[${op.input.tankId}] transitionAction`);
    const location = op.input.location ?? "倉庫";
    const tankLogNote = op.input.tankNote ?? "";
    const logNote = op.input.logNote ?? "";
    const logAction = requireTankActionCode(
      op.input.logAction ?? transitionAction,
      `[${op.input.tankId}] logAction`
    );
    const actor = op.input.context.actor;
    const nextCustomerProjection = resolveNextTankCustomerProjection({
      action: transitionAction,
      previous: prevSnapshot,
      customer: op.input.context.customer,
      mode: "operation",
    });
    const nextSnapshot: TankSnapshot = {
      status: nextStatus,
      location,
      staff: actor.staffName,
      logNote: tankLogNote,
      ...nextCustomerProjection,
    };
    const now = serverTimestamp();

    tx.set(op.logRef, {
      ...sanitizeLogExtra(op.input.logExtra),
      tankId: op.input.tankId,
      action: logAction,
      transitionAction,
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
      ...(op.input.tankExtra ?? {}),
      ...tankUpdateFromSnapshot(nextSnapshot, op.logRef.id),
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

    if (!validateTransitionCode(prevSnapshot.status, content.transitionAction)) {
      throw new Error(
        `[${newTankId}] ${transitionFailureReason(prevSnapshot.status, content.transitionAction)}`
      );
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
    status: requireTankStatusCode(data.status, "タンクのstatus"),
  };
  const customerId = optionalNullableString(data.customerId);
  const customerName = optionalNullableString(data.customerName);
  if (customerId !== undefined) snapshot.customerId = customerId;
  if (customerName !== undefined) snapshot.customerName = customerName;
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
    ...(snapshot.customerId !== undefined
      ? { customerId: snapshot.customerId }
      : {}),
    ...(snapshot.customerName !== undefined
      ? { customerName: snapshot.customerName }
      : {}),
    latestLogId,
    updatedAt: serverTimestamp(),
  };
}

function optionalNullableString(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return String(value);
}

function resolveNextTankCustomerProjection(input: {
  action: TankActionCode;
  previous: TankSnapshot;
  customer?: CustomerSnapshot;
  mode: CustomerProjectionResolveMode;
}): TankCustomerProjection {
  const { action, previous, customer, mode } = input;

  switch (action) {
    case "lend":
    case "order_lend":
      if (mode === "operation") {
        return requireCustomerProjection(customer, "貸出操作");
      }
      return customer
        ? requireCustomerProjection(customer, "貸出ログ")
        : requireExistingCustomerProjection(previous, "貸出前");

    case "carry_over":
      return resolveCarryOverCustomerProjection(previous, customer);

    case "return":
    case "return_unused":
    case "return_uncharged":
    case "fill":
    case "inhouse_use":
    case "inhouse_use_retro":
    case "inhouse_return":
    case "inhouse_return_unused":
    case "inhouse_return_uncharged":
    case "damage_report":
    case "repaired":
    case "inspection":
    case "dispose":
      return { customerId: null, customerName: null };

    case "procurement_purchase":
    case "procurement_register":
    case "supply_order":
      throw new Error(`通常タンク操作ではないactionです: ${action}`);

    default: {
      const exhaustive: never = action;
      throw new Error(`未対応のactionです: ${exhaustive}`);
    }
  }
}

function resolveCarryOverCustomerProjection(
  previous: TankSnapshot,
  customer: CustomerSnapshot | undefined
): TankCustomerProjection {
  const customerProjection = customer
    ? requireCustomerProjection(customer, "持ち越し操作")
    : undefined;

  try {
    const previousProjection = requireExistingCustomerProjection(previous, "持ち越し前");
    if (
      previousProjection.customerId === undefined
      && previousProjection.customerName === undefined
    ) {
      return customerProjection ?? {};
    }
    if (previousProjection.customerId === null && previousProjection.customerName === null) {
      return previousProjection;
    }
    if (customerProjection && previousProjection.customerId !== customerProjection.customerId) {
      throw new Error("持ち越し操作の顧客情報が現在貸出先と一致しません");
    }
    return previousProjection;
  } catch (error) {
    if (!customerProjection) throw error;
    return completeMalformedCarryOverProjection(previous, customerProjection);
  }
}

function completeMalformedCarryOverProjection(
  previous: TankSnapshot,
  customer: Required<TankCustomerProjection>
): TankCustomerProjection {
  if (previous.customerId === null || previous.customerName === null) {
    throw new Error("持ち越し前の顧客projectionが不正です");
  }

  const previousCustomerId = normalizedProjectionString(previous.customerId);
  const previousCustomerName = normalizedProjectionString(previous.customerName);

  if (
    (previousCustomerId === undefined || previousCustomerId === customer.customerId)
    && (previousCustomerName === undefined || previousCustomerName === customer.customerName)
  ) {
    return customer;
  }

  throw new Error("持ち越し前の顧客projectionが不正です");
}

function requireExistingCustomerProjection(
  snapshot: TankSnapshot,
  label: string
): TankCustomerProjection {
  const customerId = normalizedProjectionValue(snapshot.customerId, `${label}.customerId`);
  const customerName = normalizedProjectionValue(snapshot.customerName, `${label}.customerName`);

  if (customerId === undefined && customerName === undefined) return {};
  if (customerId === null && customerName === null) {
    return { customerId: null, customerName: null };
  }
  if (typeof customerId === "string" && typeof customerName === "string") {
    return { customerId, customerName };
  }

  throw new Error(`${label}の顧客projectionが不正です`);
}

function requireCustomerProjection(
  customer: CustomerSnapshot | undefined,
  label: string
): Required<TankCustomerProjection> {
  const customerId = customer?.customerId.trim() ?? "";
  const customerName = customer?.customerName.trim() ?? "";

  if (!customerId || !customerName) {
    throw new Error(`${label}の顧客情報がありません`);
  }

  return { customerId, customerName };
}

function normalizedProjectionValue(
  value: string | null | undefined,
  label: string
): string | null | undefined {
  if (value === undefined || value === null) return value;
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${label}が空です`);
  }
  return trimmed;
}

function normalizedProjectionString(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function operationIdentityFields(context: OperationContext): DocumentData {
  const actor = context.actor;
  const transactionId = stringOrUndefined(context.transactionId);
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
    ...(transactionId ? { transactionId } : {}),
    ...(context.source ? { source: context.source } : {}),
    ...(context.workflow ? { workflow: context.workflow } : {}),
    ...(context.returnCondition
      ? { returnCondition: context.returnCondition }
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
  const nextCustomerProjection = resolveNextTankCustomerProjection({
    action: content.transitionAction,
    previous: prevSnapshot,
    customer: customerSnapshotFromTankLogContent(content),
    mode: "revision",
  });
  return {
    ...prevSnapshot,
    status: requireNextStatusCode(content.transitionAction, "ログのtransitionAction"),
    location: content.location,
    staff: content.staffName,
    logNote: content.logNote,
    ...nextCustomerProjection,
  };
}

function customerSnapshotFromTankLogContent(
  content: TankLogContent
): CustomerSnapshot | undefined {
  const customerId = content.customerId?.trim() ?? "";
  const customerName = content.customerName?.trim() ?? "";
  if (!customerId || !customerName) return undefined;
  return { customerId, customerName };
}

function mergeTankLogContent(oldLog: TankLogData, patch: LogCorrectionPatch): TankLogContent {
  const oldTransitionAction = requireTankActionCode(
    oldLog.transitionAction ?? oldLog.action,
    "対象ログのtransitionAction"
  );
  const patchTransitionAction = patch.transitionAction !== undefined
    ? requireTankActionCode(patch.transitionAction, "patch.transitionAction")
    : undefined;
  const transitionAction = patchTransitionAction ?? oldTransitionAction;
  const transitionChanged = patchTransitionAction !== undefined
    && patchTransitionAction !== oldTransitionAction;
  const action = patch.logAction !== undefined
    ? requireTankActionCode(patch.logAction, "patch.logAction")
    : transitionChanged
      ? transitionAction
      : optionalTankActionCode(oldLog.action) ?? transitionAction;
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
  const transitionAction = requireTankActionCode(
    sourceLog.transitionAction ?? sourceLog.action,
    "復元元ログのtransitionAction"
  );
  const identity = tankLogIdentityFromLog(sourceLog, "復元元ログ");
  return {
    tankId: requireString(sourceLog.tankId, "復元元ログのtankId"),
    action: optionalTankActionCode(sourceLog.action) ?? transitionAction,
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

function sanitizeLogExtra(logExtra?: Record<string, unknown>): Record<string, unknown> {
  if (!logExtra) return {};
  const extra: Record<string, unknown> = {};
  Object.entries(logExtra).forEach(([key, value]) => {
    if (!RESERVED_LOG_EXTRA_FIELDS.has(key)) extra[key] = value;
  });
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
  const customerId = optionalNullableString(raw.customerId);
  const customerName = optionalNullableString(raw.customerName);
  return {
    status: requireTankStatusCode(raw.status, `${label}.status`),
    ...(customerId !== undefined ? { customerId } : {}),
    ...(customerName !== undefined ? { customerName } : {}),
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

function requireTankActionCode(value: unknown, label: string): TankActionCode {
  const code = optionalTankActionCode(value);
  if (!code) {
    throw new Error(`${label}が不正です`);
  }
  return code;
}

function optionalTankActionCode(value: unknown): TankActionCode | null {
  const code = normalizeTankActionCode(value);
  if (code) return code;
  return typeof value === "string" ? tankActionToCode(value) : null;
}

function requireTankStatusCode(value: unknown, label: string): TankStatusCode {
  const code = optionalTankStatusCode(value);
  if (!code) {
    throw new Error(`${label}が不正です`);
  }
  return code;
}

function optionalTankStatusCode(value: unknown): TankStatusCode | null {
  const code = normalizeTankStatusCode(value);
  if (code) return code;
  return typeof value === "string" ? tankStatusToCode(value) : null;
}

function requireNextStatusCode(
  action: TankActionCode,
  label: string
): TankStatusCode {
  const nextStatus = getNextStatusCode(action);
  if (!nextStatus) {
    throw new Error(`${label}に対応する遷移先ステータスがありません`);
  }
  return nextStatus;
}

function transitionFailureReason(
  status: TankStatusCode,
  action: TankActionCode
): string {
  return `「${tankStatusCodeToLegacyStatus(status)}」のタンクに「${tankActionCodeToLegacyAction(action)}」はできません`;
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
