import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  Timestamp,
  where,
  type DocumentData,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebase/config";
import {
  getTankAggregationRevisionRef,
  nextTankAggregationRevisions,
  normalizeTankAggregationRevisions,
} from "@/lib/firebase/tank-aggregation-revision-service";
import {
  STAFF_BY_EMAIL_COLLECTION,
  staffEmailKey,
} from "@/lib/firebase/staff-auth";
import {
  normalizeTransitionPlan,
  type RecoveryEvidenceKey,
  type TransitionPlan,
  type TransitionReviewStatus,
} from "@/lib/tank-transition-policy";

export const MAX_OPERATION_REVIEW_BATCH_SIZE = 100;

export type OperationReviewListMode = "pending" | "resolved";
export type OperationReviewDecision = Extract<
  TransitionReviewStatus,
  "approved" | "excluded"
>;

export type OperationReviewItem = {
  id: string;
  logId: string;
  eventId?: string;
  rootLogId: string;
  revision: number;
  logStatus?: string;
  tankId: string;
  action?: string;
  transitionAction?: string;
  staffId?: string;
  staffName?: string;
  customerId?: string;
  customerName?: string;
  occurredAt?: Timestamp;
  transitionPlan: TransitionPlan | null;
  transitionReviewStatus: OperationReviewDecision | "pending" | "unknown";
  recoveryEvidence: Partial<Record<RecoveryEvidenceKey, true>>;
  affectedCustomerIds: string[];
  hasUnknownAffectedCustomer: boolean;
  reviewedAt?: Timestamp;
  reviewedByStaffId?: string;
  reviewedByStaffName?: string;
  reviewedByUid?: string;
  reviewedByEmail?: string;
  reviewReason?: string;
  validationError?: string;
  isHistoryEvent: boolean;
};

export type ReviewOperationLogsInput = {
  logIds: string[];
  decision: OperationReviewDecision;
  reason: string;
};

const RECOVERY_EVIDENCE_KEYS = [
  "physicalTankConfirmed",
  "possessionConfirmed",
  "previousCustomerConfirmed",
  "fillStateConfirmed",
  "damageStateConfirmed",
] as const satisfies readonly RecoveryEvidenceKey[];

const REVIEWABLE_STATUSES = ["pending", "approved", "excluded"] as const;
const MAX_OPERATION_REVIEW_HISTORY_SIZE = 300;

/**
 * 例外操作レビュー一覧を取得する。
 * 複合indexへの依存を避けるためreview statusだけをqueryし、tank/active境界は読取後に検証する。
 */
export async function listOperationReviews(
  mode: OperationReviewListMode = "pending",
): Promise<OperationReviewItem[]> {
  if (mode === "resolved") return listOperationReviewHistory();

  const snapshot = await getDocs(query(
    collection(db, "logs"),
    where("transitionReviewStatus", "==", "pending"),
  ));

  return snapshot.docs
    .filter(isActiveTankLog)
    .map((logSnapshot) => toPendingOperationReviewItem(logSnapshot))
    .sort((a, b) => reviewSortMillis(b) - reviewSortMillis(a));
}

/**
 * append-only review eventを正本として処理済み履歴を取得する。
 * 対象logがvoided/supersededになってもevent自体を一覧から除外しない。
 */
export async function listOperationReviewHistory(): Promise<OperationReviewItem[]> {
  const eventSnapshot = await getDocs(query(
    collection(db, "operationReviewEvents"),
    orderBy("reviewedAt", "desc"),
    limit(MAX_OPERATION_REVIEW_HISTORY_SIZE),
  ));
  const flattenedEvents = eventSnapshot.docs.flatMap((eventDoc) => {
    const data = eventDoc.data();
    const entries = Array.isArray(data.entries)
      ? data.entries.flatMap((value: unknown) => {
        const entry = objectRecord(value);
        return entry ? [entry] : [];
      })
      : [];
    const entriesByLogId = new Map(entries.flatMap((entry) => {
      const logId = optionalNonEmptyString(entry.logId);
      return logId ? [[logId, entry] as const] : [];
    }));
    return normalizeStringArray(data.logIds).map((logId) => ({
      eventDoc,
      logId,
      entry: entriesByLogId.get(logId) ?? { logId },
    }));
  }).slice(0, MAX_OPERATION_REVIEW_HISTORY_SIZE);
  const logSnapshots = await Promise.all(flattenedEvents.map(({ logId }) => (
    getDoc(doc(db, "logs", logId))
  )));

  return flattenedEvents.map(({ eventDoc, entry }, index) => (
    toOperationReviewHistoryItem(
      eventDoc,
      entry,
      logSnapshots[index].exists() ? logSnapshots[index].data() : null,
    )
  ));
}

/** ダッシュボード表示用。新規複合indexを必要としないpending件数。 */
export async function getPendingOperationReviewCount(): Promise<number> {
  const snapshot = await getDocs(query(
    collection(db, "logs"),
    where("transitionReviewStatus", "==", "pending"),
  ));
  return snapshot.docs.filter(isActiveTankLog).length;
}

/**
 * pendingなrecovery logを正式集計へ承認、または正式集計から除外する。
 * 同じrevision上での判断変更は許可せず、全対象を一つのtransactionで処理する。
 */
export async function reviewOperationLogs(
  input: ReviewOperationLogsInput,
): Promise<void> {
  const logIds = normalizeLogIds(input.logIds);
  const decision = normalizeDecision(input.decision);
  const reason = normalizeReviewReason(input.reason);
  const authUser = auth.currentUser;
  if (!authUser) {
    throw new Error("Firebase認証ユーザーを確認できません。再ログインしてください。");
  }
  const reviewerUid = requireNonEmptyString(authUser.uid, "auth.uid");
  const reviewerEmail = requireNonEmptyString(authUser.email, "auth.email");
  const reviewerEmailKey = staffEmailKey(reviewerEmail);
  if (!reviewerEmailKey) {
    throw new Error("Firebase認証メールを確認できません。再ログインしてください。");
  }

  if (logIds.length > MAX_OPERATION_REVIEW_BATCH_SIZE) {
    throw new Error(`一度にレビューできるのは${MAX_OPERATION_REVIEW_BATCH_SIZE}件までです。`);
  }

  // 100件reviewでもRules accessを共通化できるよう、transactionごとにeventは一つだけ作る。
  // transaction再試行時も同じevent documentを使い、callback外の副作用を発生させない。
  const eventRef = doc(collection(db, "operationReviewEvents"));

  await runTransaction(db, async (transaction) => {
    const reviewerMirrorRef = doc(db, STAFF_BY_EMAIL_COLLECTION, reviewerEmailKey);
    const aggregationRevisionRef = getTankAggregationRevisionRef();
    const logRefs = logIds.map((logId) => doc(db, "logs", logId));

    // Firestore transactionでは全readをwriteより先に完了する。
    const [reviewerMirrorSnapshot, aggregationRevisionSnapshot, logSnapshots] = await Promise.all([
      transaction.get(reviewerMirrorRef),
      transaction.get(aggregationRevisionRef),
      Promise.all(logRefs.map((logRef) => transaction.get(logRef))),
    ]);

    if (!reviewerMirrorSnapshot.exists()) {
      throw new Error("認証者に対応するスタッフmirrorが見つかりません。再ログインしてください。");
    }

    const reviewerMirrorData = reviewerMirrorSnapshot.data();
    const reviewerStaffId = requireNonEmptyString(
      reviewerMirrorData.staffId,
      "staffByEmail.staffId",
    );
    if (
      reviewerMirrorData.isActive !== true
      || reviewerMirrorData.role !== "管理者"
      || staffEmailKey(requireNonEmptyString(reviewerMirrorData.email, "staffByEmail.email"))
        !== reviewerEmailKey
    ) {
      throw new Error("例外操作レビューは有効な管理者だけが実行できます。");
    }

    const reviewerRef = doc(db, "staff", reviewerStaffId);
    const reviewerSnapshot = await transaction.get(reviewerRef);
    if (!reviewerSnapshot.exists()) {
      throw new Error("認証者に対応するスタッフが見つかりません。再ログインしてください。");
    }
    const reviewerData = reviewerSnapshot.data();
    const sourceEmailKey = staffEmailKey(
      requireNonEmptyString(reviewerData.email, "staff.email"),
    );
    const linkedAuthUid = optionalNonEmptyString(reviewerData.authUid);
    if (
      reviewerData.isActive !== true
      || reviewerData.role !== "管理者"
      || sourceEmailKey !== reviewerEmailKey
      || (linkedAuthUid !== undefined && linkedAuthUid !== reviewerUid)
    ) {
      throw new Error("Firebase認証者と管理者スタッフ情報が一致しません。");
    }

    const reviewerName = requireNonEmptyString(reviewerData.name, "staff.name");
    const now = serverTimestamp();

    const reviewedLogs = logSnapshots.map((snapshot, index) => {
      if (!snapshot.exists()) {
        throw new Error(`レビュー対象のログが見つかりません: ${logIds[index]}`);
      }
      assertReviewableRecoveryLog(snapshot.data());
      return {
        ref: logRefs[index],
        id: logIds[index],
        data: snapshot.data(),
      };
    });
    const affectedCustomerIds = Array.from(new Set(reviewedLogs.flatMap(({ data }) => (
      normalizeStringArray(data.affectedCustomerIds)
    )))).sort();
    const hasUnknownAffectedCustomer = reviewedLogs.some(
      ({ data }) => data.hasUnknownAffectedCustomer === true,
    );
    const aggregationRevisions = nextTankAggregationRevisions(
      normalizeTankAggregationRevisions(
        aggregationRevisionSnapshot.exists()
          ? aggregationRevisionSnapshot.data()
          : null,
      ),
      {
        dataChanged: true,
        officialChanged: decision === "approved",
      },
    );

    transaction.set(aggregationRevisionRef, {
      ...aggregationRevisions,
      updatedAt: now,
      revisionChangeKind: "review",
      changedLogIds: logIds,
      officialAggregationLogIds: decision === "approved" ? logIds : [],
      reviewEventId: eventRef.id,
      reviewDecision: decision,
      affectedCustomerIds,
      hasUnknownAffectedCustomer,
    });

    reviewedLogs.forEach(({ ref }) => {
      transaction.update(ref, {
        transitionReviewStatus: decision,
        reviewEventId: eventRef.id,
        reviewedAt: now,
        reviewedByStaffId: reviewerStaffId,
        reviewedByStaffName: reviewerName,
        reviewedByUid: reviewerUid,
        reviewedByEmail: reviewerEmailKey,
        reviewReason: reason,
      });
    });

    // append-only batch event。logが後で取消・訂正・削除されても最小監査情報を残す。
    transaction.set(eventRef, {
      eventKind: "transition_aggregation_review_batch",
      logIds,
      decision,
      reason,
      reviewedAt: now,
      reviewedByStaffId: reviewerStaffId,
      reviewedByStaffName: reviewerName,
      reviewedByUid: reviewerUid,
      reviewedByEmail: reviewerEmailKey,
      affectedCustomerIds,
      hasUnknownAffectedCustomer,
      requiresAggregationRebuild: decision === "approved",
      entries: reviewedLogs.map(({ id, data }) => buildReviewEventEntry(id, data)),
    });
  });
}

function isActiveTankLog(snapshot: QueryDocumentSnapshot<DocumentData>): boolean {
  const data = snapshot.data();
  return data.logKind === "tank" && data.logStatus === "active";
}

function toPendingOperationReviewItem(
  snapshot: QueryDocumentSnapshot<DocumentData>,
): OperationReviewItem {
  const data = snapshot.data();
  const transitionPlan = parseTransitionPlan(data.transitionPlan);
  const recoveryEvidence = parseRecoveryEvidence(data.recoveryEvidence);
  const validationError = getRecoveryValidationError(data, transitionPlan, recoveryEvidence);
  const status = isReviewStatus(data.transitionReviewStatus)
    ? data.transitionReviewStatus
    : "pending";

  return {
    id: snapshot.id,
    logId: snapshot.id,
    rootLogId: optionalNonEmptyString(data.rootLogId) ?? snapshot.id,
    revision: numberOrZero(data.revision),
    logStatus: optionalNonEmptyString(data.logStatus),
    tankId: optionalNonEmptyString(data.tankId) ?? "",
    action: optionalNonEmptyString(data.action),
    transitionAction: optionalNonEmptyString(data.transitionAction),
    staffId: optionalNonEmptyString(data.staffId),
    staffName: optionalNonEmptyString(data.staffName)
      ?? optionalNonEmptyString(data.staff),
    customerId: optionalNonEmptyString(data.customerId),
    customerName: optionalNonEmptyString(data.customerName),
    occurredAt: timestampOrUndefined(data.originalAt)
      ?? timestampOrUndefined(data.timestamp),
    transitionPlan,
    transitionReviewStatus: status,
    recoveryEvidence,
    affectedCustomerIds: normalizeStringArray(data.affectedCustomerIds),
    hasUnknownAffectedCustomer: data.hasUnknownAffectedCustomer === true,
    reviewedAt: timestampOrUndefined(data.reviewedAt),
    reviewedByStaffId: optionalNonEmptyString(data.reviewedByStaffId),
    reviewedByStaffName: optionalNonEmptyString(data.reviewedByStaffName),
    reviewedByUid: optionalNonEmptyString(data.reviewedByUid),
    reviewedByEmail: optionalNonEmptyString(data.reviewedByEmail),
    reviewReason: optionalNonEmptyString(data.reviewReason),
    ...(validationError ? { validationError } : {}),
    isHistoryEvent: false,
  };
}

function toOperationReviewHistoryItem(
  snapshot: QueryDocumentSnapshot<DocumentData>,
  entry: Record<string, unknown>,
  currentLogData: DocumentData | null,
): OperationReviewItem {
  const event = snapshot.data();
  const logData = currentLogData ?? {};
  const logId = optionalNonEmptyString(entry.logId) ?? "";
  const transitionPlan = parseTransitionPlan(logData.transitionPlan);
  const recoveryEvidence = parseRecoveryEvidence(logData.recoveryEvidence);
  const decision = isReviewDecision(event.decision) ? event.decision : "unknown";

  return {
    id: `${snapshot.id}:${logId}`,
    eventId: snapshot.id,
    logId,
    rootLogId: optionalNonEmptyString(entry.rootLogId) ?? logId,
    revision: numberOrZero(entry.revision),
    logStatus: optionalNonEmptyString(logData.logStatus) ?? "missing",
    tankId: optionalNonEmptyString(entry.tankId)
      ?? optionalNonEmptyString(logData.tankId)
      ?? "",
    action: optionalNonEmptyString(entry.action)
      ?? optionalNonEmptyString(logData.action),
    transitionAction: optionalNonEmptyString(entry.transitionAction)
      ?? optionalNonEmptyString(logData.transitionAction),
    staffId: optionalNonEmptyString(entry.staffId)
      ?? optionalNonEmptyString(logData.staffId),
    staffName: optionalNonEmptyString(entry.staffName)
      ?? optionalNonEmptyString(logData.staffName)
      ?? optionalNonEmptyString(logData.staff),
    customerId: optionalNonEmptyString(entry.customerId)
      ?? optionalNonEmptyString(logData.customerId),
    customerName: optionalNonEmptyString(entry.customerName)
      ?? optionalNonEmptyString(logData.customerName),
    occurredAt: timestampOrUndefined(entry.occurredAt)
      ?? timestampOrUndefined(logData.originalAt)
      ?? timestampOrUndefined(logData.timestamp),
    transitionPlan,
    transitionReviewStatus: decision,
    recoveryEvidence,
    affectedCustomerIds: normalizeStringArray(entry.affectedCustomerIds),
    hasUnknownAffectedCustomer: entry.hasUnknownAffectedCustomer === true,
    reviewedAt: timestampOrUndefined(event.reviewedAt),
    reviewedByStaffId: optionalNonEmptyString(event.reviewedByStaffId),
    reviewedByStaffName: optionalNonEmptyString(event.reviewedByStaffName),
    reviewedByUid: optionalNonEmptyString(event.reviewedByUid),
    reviewedByEmail: optionalNonEmptyString(event.reviewedByEmail),
    reviewReason: optionalNonEmptyString(event.reason),
    ...(decision === "unknown"
      ? { validationError: "監査eventのレビュー判断を判定できません。" }
      : {}),
    isHistoryEvent: true,
  };
}

function buildReviewEventEntry(logId: string, data: DocumentData): Record<string, unknown> {
  return {
    logId,
    rootLogId: optionalNonEmptyString(data.rootLogId) ?? logId,
    revision: numberOrZero(data.revision),
    tankId: requireNonEmptyString(data.tankId, "log.tankId"),
    action: optionalNonEmptyString(data.action) ?? null,
    transitionAction: optionalNonEmptyString(data.transitionAction) ?? null,
    staffId: optionalNonEmptyString(data.staffId) ?? null,
    staffName: optionalNonEmptyString(data.staffName)
      ?? optionalNonEmptyString(data.staff)
      ?? null,
    customerId: optionalNonEmptyString(data.customerId) ?? null,
    customerName: optionalNonEmptyString(data.customerName) ?? null,
    occurredAt: timestampOrUndefined(data.originalAt)
      ?? timestampOrUndefined(data.timestamp)
      ?? null,
    affectedCustomerIds: normalizeStringArray(data.affectedCustomerIds),
    hasUnknownAffectedCustomer: data.hasUnknownAffectedCustomer === true,
  };
}

function assertReviewableRecoveryLog(data: DocumentData): void {
  const plan = parseTransitionPlan(data.transitionPlan);
  const evidence = parseRecoveryEvidence(data.recoveryEvidence);
  const error = getRecoveryValidationError(data, plan, evidence);
  if (error) throw new Error(error);
}

function getRecoveryValidationError(
  data: DocumentData,
  plan: TransitionPlan | null,
  evidence: Partial<Record<RecoveryEvidenceKey, true>>,
): string | undefined {
  if (data.logKind !== "tank" || data.logStatus !== "active") {
    return "最新の有効なタンク操作だけをレビューできます。";
  }
  if (data.transitionReviewStatus !== "pending") {
    return "承認待ちではない操作はレビューできません。";
  }
  if (!optionalNonEmptyString(data.tankId)) {
    return "タンクIDがないためレビューできません。";
  }
  if (!plan || plan.kind !== "recovery" || plan.steps.length === 0) {
    return "自動補完計画を検証できないためレビューできません。";
  }
  if (plan.requiredEvidence.some((key) => evidence[key] !== true)) {
    return "実行時に必要だった確認証跡が不足しています。";
  }
  return undefined;
}

function parseTransitionPlan(value: unknown): TransitionPlan | null {
  return normalizeTransitionPlan(value);
}

function parseRecoveryEvidence(
  value: unknown,
): Partial<Record<RecoveryEvidenceKey, true>> {
  const record = objectRecord(value);
  if (!record) return {};
  return Object.fromEntries(
    RECOVERY_EVIDENCE_KEYS
      .filter((key) => record[key] === true)
      .map((key) => [key, true]),
  ) as Partial<Record<RecoveryEvidenceKey, true>>;
}

function normalizeLogIds(logIds: string[]): string[] {
  const normalized = [...new Set(logIds.map((id) => id.trim()).filter(Boolean))].sort();
  if (normalized.length === 0) {
    throw new Error("レビュー対象を1件以上選択してください。");
  }
  return normalized;
}

function normalizeDecision(value: unknown): OperationReviewDecision {
  if (value !== "approved" && value !== "excluded") {
    throw new Error("レビュー判断が不正です。");
  }
  return value;
}

function normalizeReviewReason(value: string): string {
  const normalized = value.trim();
  if (normalized.length < 5) {
    throw new Error("レビュー理由を5文字以上で入力してください。");
  }
  return normalized;
}

function isReviewStatus(value: unknown): value is typeof REVIEWABLE_STATUSES[number] {
  return REVIEWABLE_STATUSES.includes(value as typeof REVIEWABLE_STATUSES[number]);
}

function isReviewDecision(value: unknown): value is OperationReviewDecision {
  return value === "approved" || value === "excluded";
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function requireNonEmptyString(value: unknown, fieldName: string): string {
  const normalized = optionalNonEmptyString(value);
  if (!normalized) throw new Error(`${fieldName} is required.`);
  return normalized;
}

function optionalNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized || undefined;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.flatMap((entry) => {
    const normalized = optionalNonEmptyString(entry);
    return normalized ? [normalized] : [];
  }))].sort();
}

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function timestampOrUndefined(value: unknown): Timestamp | undefined {
  return value instanceof Timestamp ? value : undefined;
}

function reviewSortMillis(item: OperationReviewItem): number {
  return item.reviewedAt?.toMillis() ?? item.occurredAt?.toMillis() ?? 0;
}
