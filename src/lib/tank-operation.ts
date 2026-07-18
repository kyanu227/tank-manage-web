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
  getTankAggregationRevisionRef,
  nextTankAggregationRevisions,
  normalizeTankAggregationRevisions,
} from "./firebase/tank-aggregation-revision-service";
import { getTankOperationPolicyInTransaction } from "./firebase/tank-operation-policy-service";
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
import {
  createRecoveryConfirmationFingerprint,
  deriveAffectedCustomers,
  getInitialTransitionReviewStatus,
  isOfficialTransitionAggregationEligible,
  normalizeTransitionPlan,
  normalizeTransitionAction,
  pickRequiredRecoveryEvidence,
  planTankTransition,
  resolvePlannerPolicyMode,
  type RecoveryEvidence,
  type RecoveryEvidenceKey,
  type AffectedCustomers,
  type InitialTransitionReviewStatus,
  type TransitionEnforcementMode,
  type TransitionPlan,
} from "./tank-transition-policy";
import {
  assertAtomicTankOperationCount,
} from "./tank-operation-limits";

export { MAX_ATOMIC_TANK_OPERATIONS } from "./tank-operation-limits";
import { assertRecoveryConfirmationsMatchReplannedState } from "./tank-recovery-confirmation-validation";

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
  /** 耐圧検査操作で更新されるため、取消・訂正時に復元する。 */
  maintenanceDate?: unknown;
  /** 耐圧検査操作で更新されるため、取消・訂正時に復元する。 */
  nextMaintenanceDate?: unknown;
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

  /** advisory recoveryの確認結果。通常は確認ダイアログから内部的に付与される。 */
  recoveryConfirmation?: TankRecoveryConfirmation;
}

export type TankRecoveryConfirmation = {
  fingerprint: string;
  recoveryEvidence: RecoveryEvidence;
};

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
  transitionPlan?: unknown;
  transitionReviewStatus?: unknown;
  affectedCustomerIds?: unknown;
  hasUnknownAffectedCustomer?: unknown;
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
  maintenanceDate?: unknown;
  nextMaintenanceDate?: unknown;
  extraFields: Record<string, unknown>;
};

type PlannedTankOperation = {
  input: TankOperationInput;
  logRef: DocumentReference;
  tankRef: DocumentReference;
};

type PreparedTankOperation = PlannedTankOperation & {
  prevSnapshot: TankSnapshot;
  latestLogId: string | null;
  transitionAction: TankActionCode;
  logAction: TankActionCode;
  transitionPlan: TransitionPlan;
  affectedCustomers: AffectedCustomers;
  transitionReviewStatus: InitialTransitionReviewStatus;
  policyMode: TransitionEnforcementMode;
  policyRevision: number;
};

export type TankRecoveryRequirement = {
  tankId: string;
  currentStatus: TankStatusCode;
  currentLocation: string | null;
  currentCustomerId: string | null;
  currentCustomerName: string | null;
  requestedAction: TankActionCode;
  plan: TransitionPlan;
  transitionReviewStatus: InitialTransitionReviewStatus;
};

/** transaction外のUIにだけ確認を要求するための制御用error。 */
export class TankRecoveryConfirmationRequiredError extends Error {
  readonly fingerprint: string;
  readonly requirements: TankRecoveryRequirement[];

  constructor(fingerprint: string, requirements: TankRecoveryRequirement[]) {
    super("正規の状態遷移へ自動補完するため、現物確認が必要です。");
    this.name = "TankRecoveryConfirmationRequiredError";
    this.fingerprint = fingerprint;
    this.requirements = requirements;
  }
}

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
  "transitionPlan",
  "transitionReviewStatus",
  "policyMode",
  "policyRevision",
  // 廃止済みのスタッフ理由を訂正ログへ引き継がない。
  "recoveryReason",
  "recoveryEvidence",
  "recoveryConfirmationFingerprint",
  "affectedCustomerIds",
  "hasUnknownAffectedCustomer",
  "reviewedAt",
  "reviewedByStaffId",
  "reviewedByStaffName",
  "reviewedByUid",
  "reviewedByEmail",
  "reviewEventId",
  "reviewReason",
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
  "transitionPlan",
  "transitionReviewStatus",
  "policyMode",
  "policyRevision",
  // 廃止済みのスタッフ理由をlogExtra経由で再導入させない。
  "recoveryReason",
  "recoveryEvidence",
  "recoveryConfirmationFingerprint",
  "affectedCustomerIds",
  "hasUnknownAffectedCustomer",
  "reviewEventId",
]);

const PRIVILEGED_CORRECTION_ROLES: StaffCorrectionRole[] = ["管理者", "準管理者"];
const CORRECTION_LIMIT_MS = 72 * 60 * 60 * 1000;
const TANK_OPERATION_EXTRA_FIELDS = [
  "maintenanceDate",
  "nextMaintenanceDate",
] as const;
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

  const [result] = await runPlannedOperationsWithRecoveryConfirmation([planned]);

  return { ...result, logId: logRef.id };
}

/**
 * 複数タンクの操作を一括実行する。
 * 追加書き込みは transaction writer の set/update/delete だけに寄せる。
 */
export async function applyBulkTankOperations(
  inputs: TankOperationInput[],
  extraOps?: (writer: TankOperationWriter) => void,
): Promise<TankOperationResult[]> {
  if (inputs.length === 0) return [];
  assertAtomicTankOperationCount(inputs.length);

  assertNoDuplicateTankIds(inputs);

  const planned = inputs.map((input) => {
    const tankId = normalizeTankId(input.tankId);
    return {
      input: { ...input, tankId },
      logRef: doc(collection(db, "logs")),
      tankRef: doc(db, "tanks", tankId),
    };
  });

  return runPlannedOperationsWithRecoveryConfirmation(planned, extraOps);
}

async function runPlannedOperationsWithRecoveryConfirmation(
  initialPlanned: PlannedTankOperation[],
  extraOps?: (writer: TankOperationWriter) => void,
): Promise<TankOperationResult[]> {
  let planned = initialPlanned;

  for (;;) {
    try {
      return await runTransaction(db, async (tx) => {
        const results = await commitPlannedOperations(tx, planned);
        // callbackはtransaction writerへの宣言的な追加だけに限定する。
        if (extraOps) extraOps(tx as unknown as TankOperationWriter);
        return results;
      });
    } catch (error) {
      const requirement = asRecoveryConfirmationRequiredError(error);
      if (!requirement) throw error;

      const confirmation = requestRecoveryConfirmation(requirement);
      planned = planned.map((operation) => ({
        ...operation,
        input: {
          ...operation.input,
          recoveryConfirmation: confirmation,
        },
      }));
    }
  }
}

async function commitPlannedOperations(
  tx: Transaction,
  planned: PlannedTankOperation[]
): Promise<TankOperationResult[]> {
  // policy read失敗はstrictとして続行せず、transaction全体をfail closedにする。
  const policy = await getTankOperationPolicyInTransaction(tx);
  const aggregationRevisionRef = getTankAggregationRevisionRef();
  const [tankSnaps, aggregationRevisionSnapshot] = await Promise.all([
    Promise.all(planned.map((op) => tx.get(op.tankRef))),
    tx.get(aggregationRevisionRef),
  ]);

  const prepared = planned.map((op, index): PreparedTankOperation => {
    const tankSnap = tankSnaps[index];
    if (!tankSnap.exists()) {
      throw new Error(`[${op.input.tankId}] タンクが存在しません`);
    }

    const tankData = tankSnap.data();
    const prevSnapshot = snapshotFromTankData(tankData);
    const requestedTransitionAction = requireTankActionCode(
      op.input.transitionAction,
      `[${op.input.tankId}] transitionAction`
    );
    const requestedAction = requireTankActionCode(
      op.input.logAction ?? requestedTransitionAction,
      `[${op.input.tankId}] logAction`,
    );
    assertVisibleActionContext(requestedAction, op.input.context);
    const expectedTransitionAction = normalizeTransitionAction(requestedTransitionAction);
    if (!expectedTransitionAction) {
      throw new Error(`[${op.input.tankId}] 通常のタンク状態遷移ではない操作です。`);
    }

    const effectivePolicyMode = resolvePlannerPolicyMode(
      policy.transitionEnforcement,
      op.input.context,
      requestedAction,
    );
    const planResult = planTankTransition({
      policyMode: effectivePolicyMode,
      current: {
        status: prevSnapshot.status,
        customerId: prevSnapshot.customerId,
        customerName: prevSnapshot.customerName,
        location: prevSnapshot.location,
      },
      requestedAction,
      targetCustomer: op.input.context.customer ?? null,
      targetLocation: op.input.location ?? null,
    });
    if (!planResult.ok) {
      throw new Error(`[${op.input.tankId}] ${planResult.reason}`);
    }
    if (planResult.transitionAction !== expectedTransitionAction) {
      throw new Error(`[${op.input.tankId}] 表示操作と状態遷移操作が一致しません。`);
    }

    const affectedCustomers = deriveAffectedCustomers(
      planResult.plan,
      op.input.context.customer?.customerId,
    );
    return {
      ...op,
      prevSnapshot,
      latestLogId: stringOrNull(tankData.latestLogId),
      transitionAction: planResult.transitionAction,
      logAction: requestedAction,
      transitionPlan: planResult.plan,
      affectedCustomers,
      transitionReviewStatus: getInitialTransitionReviewStatus(
        planResult.plan,
        affectedCustomers.hasUnknownAffectedCustomer,
      ),
      // policyModeは設定snapshot。contextによるstrict固定はtransitionPlanへ反映する。
      policyMode: policy.transitionEnforcement,
      policyRevision: policy.policyRevision,
    };
  });

  const recoveries = prepared.filter((operation) => operation.transitionPlan.kind === "recovery");
  let recoveryFingerprint: string | null = null;
  if (recoveries.length > 0) {
    recoveryFingerprint = await createRecoveryConfirmationFingerprint(
      recoveries.map((operation) => ({
        tankId: operation.input.tankId,
        latestLogId: operation.latestLogId,
        status: operation.prevSnapshot.status,
        location: operation.prevSnapshot.location,
        customerId: operation.prevSnapshot.customerId,
        customerName: operation.prevSnapshot.customerName,
        requestedAction: operation.logAction,
        plan: operation.transitionPlan,
        policyRevision: operation.policyRevision,
      })),
    );

    const confirmationWasSupplied = assertRecoveryConfirmationsMatchReplannedState(
      recoveries.map((operation) => ({
        tankId: operation.input.tankId,
        plan: operation.transitionPlan,
        expectedFingerprint: recoveryFingerprint!,
        confirmation: operation.input.recoveryConfirmation,
      })),
    );
    if (!confirmationWasSupplied) {
      throw new TankRecoveryConfirmationRequiredError(
        recoveryFingerprint,
        recoveries.map((operation) => ({
          tankId: operation.input.tankId,
          currentStatus: operation.prevSnapshot.status,
          currentLocation: operation.prevSnapshot.location ?? null,
          currentCustomerId: operation.prevSnapshot.customerId ?? null,
          currentCustomerName: operation.prevSnapshot.customerName ?? null,
          requestedAction: operation.logAction,
          plan: operation.transitionPlan,
          transitionReviewStatus: operation.transitionReviewStatus,
        })),
      );
    }
  }

  const results: TankOperationResult[] = [];
  const officialAggregationLogIds = prepared
    .filter((operation) => operation.transitionReviewStatus === "not_required")
    .map((operation) => operation.logRef.id)
    .sort();
  const pendingRecoveryLogIds = prepared
    .filter((operation) => operation.transitionReviewStatus === "pending")
    .map((operation) => operation.logRef.id)
    .sort();
  // Rulesは先頭logをrequest.time anchorにする。正式集計が変わる混在batchではnot_requiredを必ず先頭に置く。
  const changedLogIds = [...officialAggregationLogIds, ...pendingRecoveryLogIds];
  const affectedCustomerIds = new Set<string>();
  let hasUnknownAffectedCustomer = false;
  prepared.forEach((operation) => {
    const affected = operation.affectedCustomers;
    affected.affectedCustomerIds.forEach((customerId) => affectedCustomerIds.add(customerId));
    if (affected.hasUnknownAffectedCustomer) hasUnknownAffectedCustomer = true;
  });
  const nextAggregationRevisions = nextTankAggregationRevisions(
    normalizeTankAggregationRevisions(
      aggregationRevisionSnapshot.exists() ? aggregationRevisionSnapshot.data() : null,
    ),
    {
      dataChanged: true,
      officialChanged: officialAggregationLogIds.length > 0,
    },
  );
  tx.set(aggregationRevisionRef, {
    ...nextAggregationRevisions,
    updatedAt: serverTimestamp(),
    revisionChangeKind: "operation",
    changedLogIds,
    officialAggregationLogIds,
    reviewEventId: null,
    reviewDecision: null,
    affectedCustomerIds: [...affectedCustomerIds].sort(),
    hasUnknownAffectedCustomer,
  });

  prepared.forEach((operation) => {
    const { input, transitionAction, transitionPlan, logAction } = operation;
    const finalStep = transitionPlan.steps.at(-1)!;
    const nextStatus = finalStep.toStatus;
    const location = finalStep.location ?? input.location ?? "倉庫";
    const tankLogNote = input.tankNote ?? "";
    const logNote = input.logNote ?? "";
    const actor = input.context.actor;
    const nextCustomerProjection = resolveNextTankCustomerProjection({
      action: transitionAction,
      previous: operation.prevSnapshot,
      customer: input.context.customer,
      mode: "operation",
    });
    const nextSnapshot = applyTankExtraToSnapshot({
      // 操作projection以外（耐圧日等）は通常操作で失わない。
      ...operation.prevSnapshot,
      status: nextStatus,
      location,
      staff: actor.staffName,
      logNote: tankLogNote,
      ...nextCustomerProjection,
    }, input.tankExtra, transitionAction);
    const reviewStatus = operation.transitionReviewStatus;
    const affectedCustomers = operation.affectedCustomers;
    const confirmation = input.recoveryConfirmation;
    const now = serverTimestamp();

    tx.set(operation.logRef, {
      ...sanitizeLogExtra(input.logExtra),
      tankId: input.tankId,
      action: logAction,
      transitionAction,
      prevStatus: operation.prevSnapshot.status,
      newStatus: nextStatus,
      location,
      ...operationIdentityFields(input.context),
      note: logNote,
      logNote: tankLogNote,
      transitionPlan,
      transitionReviewStatus: reviewStatus,
      policyMode: operation.policyMode,
      policyRevision: operation.policyRevision,
      affectedCustomerIds: affectedCustomers.affectedCustomerIds,
      hasUnknownAffectedCustomer: affectedCustomers.hasUnknownAffectedCustomer,
      ...(transitionPlan.kind === "recovery" && confirmation
        ? {
            recoveryEvidence: pickRequiredRecoveryEvidence(
              transitionPlan.requiredEvidence,
              confirmation.recoveryEvidence,
            ),
            recoveryConfirmationFingerprint: recoveryFingerprint,
          }
        : {}),
      timestamp: now,
      originalAt: now,
      revisionCreatedAt: now,
      logStatus: "active",
      logKind: "tank",
      rootLogId: operation.logRef.id,
      revision: 1,
      prevTankSnapshot: operation.prevSnapshot,
      nextTankSnapshot: nextSnapshot,
      previousLogIdOnSameTank: operation.latestLogId,
    });

    tx.update(operation.tankRef, {
      ...tankUpdateFromSnapshot(nextSnapshot, operation.logRef.id),
    });

    results.push({
      tankId: input.tankId,
      nextStatus,
      logRef: operation.logRef,
      tankRef: operation.tankRef,
    });
  });

  return results;
}

function asRecoveryConfirmationRequiredError(
  error: unknown,
): TankRecoveryConfirmationRequiredError | null {
  if (error instanceof TankRecoveryConfirmationRequiredError) return error;
  if (!error || typeof error !== "object") return null;
  const candidate = error as Partial<TankRecoveryConfirmationRequiredError>;
  if (
    candidate.name !== "TankRecoveryConfirmationRequiredError"
    || typeof candidate.fingerprint !== "string"
    || !Array.isArray(candidate.requirements)
  ) {
    return null;
  }
  return new TankRecoveryConfirmationRequiredError(
    candidate.fingerprint,
    candidate.requirements,
  );
}

/** native dialogはtransaction callbackの外でだけ呼び出す。 */
function requestRecoveryConfirmation(
  error: TankRecoveryConfirmationRequiredError,
): TankRecoveryConfirmation {
  if (typeof window === "undefined") {
    throw new Error(
      "自動補完には画面上での現物確認が必要です。ブラウザから操作してください。",
    );
  }

  error.requirements.forEach(assertRecoveryRequirementCanBeConfirmed);

  // 一括操作でもタンクごとに全stepと確認対象を読めるよう、1本ずつ確認する。
  for (const [index, requirement] of error.requirements.entries()) {
    const aggregationNotice = requirement.transitionReviewStatus === "pending"
      ? "外部顧客の貸出サイクルに影響するため、管理者レビュー完了まで請求・売上・スタッフ実績へ算入されません。"
      : "外部顧客の貸出サイクルを変更しない内部補完のため、確定後すぐに正式操作として扱われます。";
    const accepted = window.confirm([
      `状態遷移の自動補完を実行します（${index + 1}/${error.requirements.length}）。`,
      "画面上は指定操作として確定しますが、内部では下記の正規手順を一括記録します。",
      aggregationNotice,
      "表示された現物・貸出先・充填状態等をすべて確認した場合だけ［OK］を押してください。",
      "",
      buildRecoveryRequirementDetails(requirement),
    ].join("\n"));
    if (!accepted) {
      throw new Error("自動補完操作をキャンセルしました。");
    }
  }

  const recoveryEvidence: RecoveryEvidence = {};
  error.requirements.forEach((requirement) => {
    requirement.plan.requiredEvidence.forEach((key) => {
      recoveryEvidence[key] = true;
    });
  });

  return {
    fingerprint: error.fingerprint,
    recoveryEvidence,
  };
}

const RECOVERY_EVIDENCE_LABELS: Record<RecoveryEvidenceKey, string> = {
  physicalTankConfirmed: "目の前の現物と、表示されたタンクID/番号が一致する",
  possessionConfirmed: "現物を回収済みで、表示された現在holderが実際に占有していない",
  previousCustomerConfirmed: "表示された旧貸出先が、このタンクの直前の貸出先である",
  fillStateConfirmed: "現物のガス充填状態が、表示された充填stepの実行内容と一致する",
  damageStateConfirmed: "現物の破損・故障・不良状態を目視し、表示状態と一致する",
};

function assertRecoveryRequirementCanBeConfirmed(
  requirement: TankRecoveryRequirement,
): void {
  if (!requirement.plan.requiredEvidence.includes("previousCustomerConfirmed")) return;
  const previousCustomerStep = requirement.plan.steps.find(
    (step) => step.businessEffect === "rental_close",
  );
  if (!previousCustomerStep?.customerId?.trim() || !previousCustomerStep.customerName?.trim()) {
    throw new Error(
      `[${requirement.tankId}] 旧貸出先customerId/customerNameを表示できないため、自動補完を確認完了にできません。`,
    );
  }
}

function buildRecoveryRequirementDetails(
  requirement: TankRecoveryRequirement,
): string {
  const finalStep = requirement.plan.steps.at(-1)!;
  const previousCustomerStep = requirement.plan.steps.find(
    (step) => step.businessEffect === "rental_close",
  );
  const newCustomerStep = [...requirement.plan.steps].reverse().find(
    (step) => step.businessEffect === "rental_open",
  );
  const stepDetails = requirement.plan.steps.flatMap((step, index) => [
    `step ${index + 1}: ${tankActionCodeToLegacyAction(step.action)} (${step.action})`,
    `  状態: ${tankStatusCodeToLegacyStatus(step.fromStatus)} (${step.fromStatus}) → ${tankStatusCodeToLegacyStatus(step.toStatus)} (${step.toStatus})`,
    `  実行者: ${step.actorType === "system" ? "システム補完" : "担当者操作"} (${step.actorType})`,
    `  顧客: ${formatCustomer(step.customerId, step.customerName, "該当なし")}`,
    `  場所: ${step.location?.trim() || "未設定"}`,
  ]);
  const evidence = requirement.plan.requiredEvidence.map(
    (key) => `・${RECOVERY_EVIDENCE_LABELS[key]} [${key}]`,
  );

  return [
    `タンクID/番号: ${requirement.tankId}`,
    `表示操作: ${tankActionCodeToLegacyAction(requirement.requestedAction)} (${requirement.requestedAction})`,
    `現在status: ${tankStatusCodeToLegacyStatus(requirement.currentStatus)} (${requirement.currentStatus})`,
    `現在location: ${requirement.currentLocation?.trim() || "未設定"}`,
    `現在holder customer: ${formatCustomer(requirement.currentCustomerId, requirement.currentCustomerName, "なし")}`,
    `旧貸出先customer: ${formatCustomer(previousCustomerStep?.customerId, previousCustomerStep?.customerName, "該当なし")}`,
    `新貸出先customer: ${formatCustomer(newCustomerStep?.customerId, newCustomerStep?.customerName, "該当なし")}`,
    `最終状態: ${tankStatusCodeToLegacyStatus(finalStep.toStatus)} (${finalStep.toStatus})`,
    "",
    "内部で記録するtransition steps:",
    ...stepDetails,
    "",
    "plannerが要求した確認項目:",
    ...evidence,
  ].join("\n");
}

function formatCustomer(
  customerId: string | null | undefined,
  customerName: string | null | undefined,
  emptyLabel: string,
): string {
  const id = customerId?.trim();
  const name = customerName?.trim();
  if (id && name) return `${name} (customerId: ${id})`;
  if (id) return `名称不明 (customerId: ${id})`;
  if (name) return `${name} (customerId不明)`;
  return emptyLabel;
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
  const aggregationRevisionRef = getTankAggregationRevisionRef();

  await runTransaction(db, async (tx) => {
    const [policy, aggregationRevisionSnapshot] = await Promise.all([
      getTankOperationPolicyInTransaction(tx),
      tx.get(aggregationRevisionRef),
    ]);
    const targetSnap = await tx.get(targetRef);
    if (!targetSnap.exists()) {
      throw new Error("対象ログが存在しません");
    }

    const oldLog = targetSnap.data() as TankLogData;
    assertActiveTankLog(oldLog);
    const oldTransitionPlan = normalizeTransitionPlan(oldLog.transitionPlan);
    if (!oldTransitionPlan) {
      throw new Error("対象ログのtransitionPlanを検証できません");
    }
    if (oldTransitionPlan.kind === "recovery") {
      throw new Error("自動補完ログは直接編集できません。取消後に正しい操作を再実行してください");
    }
    if (oldLog.transitionReviewStatus !== "not_required") {
      throw new Error("直接操作ログの集計状態が不正なため編集できません");
    }
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
      const sourceTransitionPlan = normalizeTransitionPlan(sourceLog.transitionPlan);
      if (!sourceTransitionPlan || sourceTransitionPlan.kind === "recovery") {
        throw new Error("自動補完されたrevisionへは直接復元できません");
      }
      if (sourceLog.transitionReviewStatus !== "not_required") {
        throw new Error("正式集計状態を確認できないrevisionへは復元できません");
      }
      if (requireString(sourceLog.rootLogId, "復元元ログのrootLogId") !== requireString(oldLog.rootLogId, "対象ログのrootLogId")) {
        throw new Error("同一チェーン内のログだけ復元できます");
      }
    }

    const content = input.mode === "revert" && sourceLog
      ? tankLogContentFromSource(sourceLog)
      : mergeTankLogContent(oldLog, input.patch ?? {});
    assertVisibleActionContext(content.action, content.extraFields);
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

    const correctionPlanResult = planTankTransition({
      policyMode: policy.transitionEnforcement,
      current: {
        status: prevSnapshot.status,
        customerId: prevSnapshot.customerId,
        customerName: prevSnapshot.customerName,
        location: prevSnapshot.location,
      },
      requestedAction: content.action,
      targetCustomer: customerSnapshotFromTankLogContent(content) ?? null,
      targetLocation: content.location,
    });
    const expectedTransitionAction = normalizeTransitionAction(content.transitionAction);
    if (
      !correctionPlanResult.ok
      || correctionPlanResult.plan.kind !== "direct"
      || correctionPlanResult.transitionAction !== expectedTransitionAction
    ) {
      throw new Error(
        `[${newTankId}] 訂正後の正規状態遷移を構成できません${correctionPlanResult.ok ? "" : `: ${correctionPlanResult.reason}`}`,
      );
    }
    const affectedCustomers = deriveAffectedCustomers(
      correctionPlanResult.plan,
      content.customerId,
    );
    const invalidatedCustomerIds = Array.from(new Set([
      ...normalizeStringArray(oldLog.affectedCustomerIds),
      ...affectedCustomers.affectedCustomerIds,
    ])).sort();
    const nextAggregationRevisions = nextTankAggregationRevisions(
      normalizeTankAggregationRevisions(
        aggregationRevisionSnapshot.exists() ? aggregationRevisionSnapshot.data() : null,
      ),
      { dataChanged: true, officialChanged: true },
    );

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

    tx.set(aggregationRevisionRef, {
      ...nextAggregationRevisions,
      updatedAt: serverTimestamp(),
      revisionChangeKind: "correction",
      changedLogIds: [newLogRef.id, input.targetLogId],
      officialAggregationLogIds: [newLogRef.id, input.targetLogId],
      reviewEventId: null,
      reviewDecision: null,
      affectedCustomerIds: invalidatedCustomerIds,
      hasUnknownAffectedCustomer:
        oldLog.hasUnknownAffectedCustomer === true
        || affectedCustomers.hasUnknownAffectedCustomer,
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
      transitionPlan: correctionPlanResult.plan,
      transitionReviewStatus: "not_required",
      policyMode: policy.transitionEnforcement,
      policyRevision: policy.policyRevision,
      affectedCustomerIds: affectedCustomers.affectedCustomerIds,
      hasUnknownAffectedCustomer: affectedCustomers.hasUnknownAffectedCustomer,
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
  const aggregationRevisionRef = getTankAggregationRevisionRef();

  await runTransaction(db, async (tx) => {
    const [logSnap, aggregationRevisionSnapshot] = await Promise.all([
      tx.get(logRef),
      tx.get(aggregationRevisionRef),
    ]);
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
    const officialAggregationChanged = isOfficialAggregationTankLog(log);
    const nextAggregationRevisions = nextTankAggregationRevisions(
      normalizeTankAggregationRevisions(
        aggregationRevisionSnapshot.exists() ? aggregationRevisionSnapshot.data() : null,
      ),
      { dataChanged: true, officialChanged: officialAggregationChanged },
    );
    tx.update(logRef, {
      logStatus: "voided",
      voidReason: reason,
      voidedAt: serverTimestamp(),
      ...voiderAuditFields(input.voider),
    });
    tx.set(aggregationRevisionRef, {
      ...nextAggregationRevisions,
      updatedAt: serverTimestamp(),
      revisionChangeKind: "void",
      changedLogIds: [input.logId],
      officialAggregationLogIds: officialAggregationChanged ? [input.logId] : [],
      reviewEventId: null,
      reviewDecision: null,
      affectedCustomerIds: normalizeStringArray(log.affectedCustomerIds),
      hasUnknownAffectedCustomer: log.hasUnknownAffectedCustomer === true,
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

function assertVisibleActionContext(
  action: TankActionCode,
  context: Pick<OperationContext, "source" | "workflow" | "transactionId">
    | Record<string, unknown>,
): void {
  if (action !== "order_lend") return;
  if (
    context.source !== "order_fulfillment"
    || context.workflow !== "order"
    || !stringOrUndefined(context.transactionId)
  ) {
    throw new Error("受注貸出は受注transactionの完了処理でだけ実行できます");
  }
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
  if (data.maintenanceDate !== undefined) snapshot.maintenanceDate = data.maintenanceDate;
  if (data.nextMaintenanceDate !== undefined) {
    snapshot.nextMaintenanceDate = data.nextMaintenanceDate;
  }
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
    customerId: snapshot.customerId !== undefined
      ? snapshot.customerId
      : deleteField(),
    customerName: snapshot.customerName !== undefined
      ? snapshot.customerName
      : deleteField(),
    maintenanceDate: snapshot.maintenanceDate !== undefined
      ? snapshot.maintenanceDate
      : deleteField(),
    nextMaintenanceDate: snapshot.nextMaintenanceDate !== undefined
      ? snapshot.nextMaintenanceDate
      : deleteField(),
    latestLogId,
    updatedAt: serverTimestamp(),
  };
}

function applyTankExtraToSnapshot(
  snapshot: TankSnapshot,
  tankExtra: Record<string, unknown> | undefined,
  transitionAction: TankActionCode,
): TankSnapshot {
  if (!tankExtra) return snapshot;

  const unsupportedKeys = Object.keys(tankExtra).filter(
    (key) => !(TANK_OPERATION_EXTRA_FIELDS as readonly string[]).includes(key),
  );
  if (unsupportedKeys.length > 0) {
    throw new Error(`tankExtraに未対応のfieldがあります: ${unsupportedKeys.join(", ")}`);
  }
  if (Object.keys(tankExtra).length > 0 && transitionAction !== "inspection") {
    throw new Error("耐圧日情報は耐圧検査操作でだけ更新できます");
  }

  const next = { ...snapshot };
  for (const key of TANK_OPERATION_EXTRA_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(tankExtra, key)) continue;
    const value = tankExtra[key];
    if (value === undefined) {
      throw new Error(`tankExtra.${key}にundefinedは保存できません`);
    }
    next[key] = value;
  }
  return next;
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
    ...(content.maintenanceDate !== undefined
      ? { maintenanceDate: content.maintenanceDate }
      : {}),
    ...(content.nextMaintenanceDate !== undefined
      ? { nextMaintenanceDate: content.nextMaintenanceDate }
      : {}),
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
  const oldNextSnapshot = requireTankSnapshot(
    oldLog.nextTankSnapshot,
    "対象ログのnextTankSnapshot",
  );

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
    ...(oldNextSnapshot.maintenanceDate !== undefined
      ? { maintenanceDate: oldNextSnapshot.maintenanceDate }
      : {}),
    ...(oldNextSnapshot.nextMaintenanceDate !== undefined
      ? { nextMaintenanceDate: oldNextSnapshot.nextMaintenanceDate }
      : {}),
    extraFields: copyBodyExtraFields(oldLog),
  };
}

function tankLogContentFromSource(sourceLog: TankLogData): TankLogContent {
  const transitionAction = requireTankActionCode(
    sourceLog.transitionAction ?? sourceLog.action,
    "復元元ログのtransitionAction"
  );
  const identity = tankLogIdentityFromLog(sourceLog, "復元元ログ");
  const sourceNextSnapshot = requireTankSnapshot(
    sourceLog.nextTankSnapshot,
    "復元元ログのnextTankSnapshot",
  );
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
    ...(sourceNextSnapshot.maintenanceDate !== undefined
      ? { maintenanceDate: sourceNextSnapshot.maintenanceDate }
      : {}),
    ...(sourceNextSnapshot.nextMaintenanceDate !== undefined
      ? { nextMaintenanceDate: sourceNextSnapshot.nextMaintenanceDate }
      : {}),
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
  if (!normalizeTransitionPlan(log.transitionPlan)) {
    throw new Error("transitionPlanを検証できないログは編集・取消できません");
  }
}

function isOfficialAggregationTankLog(log: TankLogData): boolean {
  const plan = normalizeTransitionPlan(log.transitionPlan);
  if (!plan || typeof log.hasUnknownAffectedCustomer !== "boolean") return false;
  return isOfficialTransitionAggregationEligible(
    plan,
    log.transitionReviewStatus,
    log.hasUnknownAffectedCustomer,
  );
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
    ...(raw.maintenanceDate !== undefined
      ? { maintenanceDate: raw.maintenanceDate }
      : {}),
    ...(raw.nextMaintenanceDate !== undefined
      ? { nextMaintenanceDate: raw.nextMaintenanceDate }
      : {}),
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

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.flatMap((item) => {
    const normalized = stringOrUndefined(item);
    return normalized ? [normalized] : [];
  }))).sort();
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
