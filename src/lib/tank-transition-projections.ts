import type { Timestamp } from "firebase/firestore";
import type { LogDoc } from "@/lib/firebase/repositories/types";
import {
  deriveAffectedCustomers,
  isOfficialTransitionAggregationEligible,
  isTransitionReviewStatusConsistent,
  normalizeTransitionPlan,
  type TransitionBusinessEffect,
  type TransitionPlan,
  type TransitionStep,
} from "@/lib/tank-transition-policy";
import {
  normalizeTankActionCode,
  type TankActionCode,
} from "@/lib/tank-action-status-codes";

/**
 * 1件のlogに格納された状態遷移stepの投影。
 * occurredAtは常に元の操作日時であり、レビュー日時は使わない。
 */
export type ProjectedStateTransition = TransitionStep & {
  logId: string;
  tankId?: string;
  stepIndex: number;
  occurredAt?: Timestamp;
};

export type ProjectedRentalCycleEvent = ProjectedStateTransition & {
  businessEffect: Exclude<TransitionBusinessEffect, "state_only">;
};

export type OfficialAggregationEvent = ProjectedStateTransition & {
  actorType: "operator";
};

export interface PendingTransitionReviewImpact {
  affectedCustomerIds: string[];
  hasUnknownAffectedCustomer: boolean;
  pendingLogIds: string[];
}

/**
 * transitionPlan必須schemaへの移行前ログを、正式集計で黙って無視しないためのguard。
 * Data Reset完了前に新consumerだけをdeployした場合は、空請求書を作らずfail closedにする。
 */
export function assertOfficialAggregationSchemaReady(logs: readonly LogDoc[]): void {
  const invalidLogIds = logs.flatMap((log) => {
    if (log.logKind === "order" || log.logKind === "procurement") return [];
    // legacy logのlogKind欠落を非tankと推測して集計続行しない。
    if (log.logKind !== "tank") return [log.id];
    if (log.logStatus !== "active") return [];
    const plan = normalizeTransitionPlan(log.transitionPlan);
    const reviewStatusValid = plan
      ? isTransitionReviewStatusConsistent(
          plan,
          log.transitionReviewStatus,
          log.hasUnknownAffectedCustomer === true,
        )
      : false;
    const policyValid = (log.policyMode === "strict" || log.policyMode === "advisory")
      && typeof log.policyRevision === "number"
      && Number.isSafeInteger(log.policyRevision)
      && log.policyRevision >= 0;
    const impactValid = Array.isArray(log.affectedCustomerIds)
      && typeof log.hasUnknownAffectedCustomer === "boolean";
    return plan && reviewStatusValid && policyValid && impactValid ? [] : [log.id];
  });

  if (invalidLogIds.length === 0) return;
  const preview = invalidLogIds.slice(0, 5).join(", ");
  const suffix = invalidLogIds.length > 5 ? ` 他${invalidLogIds.length - 5}件` : "";
  throw new Error(
    `transitionPlan必須schemaへ未移行のactive tank logがあります (${preview}${suffix})。`
      + " Data Resetとschema verificationが完了するまで正式集計を生成できません。",
  );
}

/** 編集revisionでも変わらない元の業務操作日時。 */
export function getOperationOccurredAt(log: LogDoc): Timestamp | undefined {
  return log.originalAt ?? log.timestamp;
}

/** tankの現在状態を構成するすべてのstepを返す。 */
export function projectStateTransitions(log: LogDoc): ProjectedStateTransition[] {
  const plan = getActiveTankTransitionPlan(log);
  if (!plan) return [];

  const occurredAt = getOperationOccurredAt(log);
  return plan.steps.map((step, stepIndex) => ({
    ...step,
    logId: log.id,
    tankId: log.tankId,
    stepIndex,
    occurredAt,
  }));
}

/** 貸出サイクルの開始・終了境界だけを返す。 */
export function projectRentalCycleEvents(log: LogDoc): ProjectedRentalCycleEvent[] {
  return projectStateTransitions(log).filter(
    (event): event is ProjectedRentalCycleEvent => event.businessEffect !== "state_only",
  );
}

/**
 * 請求・売上・スタッフ実績に算入できる最終operator操作を返す。
 * directと内部recoveryはnot_required、外部影響recoveryはapprovedのとき対象とする。
 */
export function projectOfficialAggregationEvent(
  log: LogDoc,
): OfficialAggregationEvent | null {
  const plan = getActiveTankTransitionPlan(log);
  if (!plan) return null;
  if (typeof log.hasUnknownAffectedCustomer !== "boolean") return null;

  const reviewEligible = isOfficialTransitionAggregationEligible(
    plan,
    log.transitionReviewStatus,
    log.hasUnknownAffectedCustomer,
  );
  if (!reviewEligible) return null;

  const transitionAction = normalizeTankActionCode(log.transitionAction);
  const stepIndex = plan.steps.length - 1;
  const finalStep = plan.steps[stepIndex];
  if (
    !finalStep
    || finalStep.actorType !== "operator"
    || !transitionAction
    || finalStep.action !== transitionAction
  ) {
    return null;
  }

  return {
    ...finalStep,
    actorType: "operator",
    logId: log.id,
    tankId: log.tankId,
    stepIndex,
    occurredAt: getOperationOccurredAt(log),
  };
}

/**
 * pending recoveryが印刷を停止すべき顧客範囲を集約する。
 * malformedなpending logは安全側に倒し、影響顧客不明として全体停止にする。
 */
export function collectPendingTransitionReviewImpact(
  logs: readonly LogDoc[],
): PendingTransitionReviewImpact {
  const affectedCustomerIds = new Set<string>();
  const pendingLogIds: string[] = [];
  let hasUnknownAffectedCustomer = false;

  for (const log of logs) {
    if (
      log.logKind !== "tank"
      || log.logStatus !== "active"
      || log.transitionReviewStatus !== "pending"
    ) {
      continue;
    }

    pendingLogIds.push(log.id);
    const plan = normalizeTransitionPlan(log.transitionPlan);
    const derivedImpact = plan
      ? deriveAffectedCustomers(plan, log.customerId)
      : null;
    const ids = Array.from(new Set([
      ...normalizeAffectedCustomerIds(log.affectedCustomerIds),
      ...(derivedImpact?.affectedCustomerIds ?? []),
    ])).sort();
    ids.forEach((id) => affectedCustomerIds.add(id));
    const hasRentalBoundary = plan?.steps.some(
      (step) => step.businessEffect === "rental_open" || step.businessEffect === "rental_close",
    ) === true;

    if (
      !plan
      || plan.kind !== "recovery"
      || log.hasUnknownAffectedCustomer === true
      || derivedImpact?.hasUnknownAffectedCustomer === true
      || (hasRentalBoundary && ids.length === 0)
    ) {
      hasUnknownAffectedCustomer = true;
    }
  }

  return {
    affectedCustomerIds: Array.from(affectedCustomerIds).sort(),
    hasUnknownAffectedCustomer,
    pendingLogIds: pendingLogIds.sort(),
  };
}

function getActiveTankTransitionPlan(log: LogDoc): TransitionPlan | null {
  if (log.logKind !== "tank" || log.logStatus !== "active") return null;
  return normalizeTransitionPlan(log.transitionPlan);
}

function normalizeAffectedCustomerIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.flatMap((item) => {
    if (typeof item !== "string") return [];
    const normalized = item.trim();
    return normalized ? [normalized] : [];
  }))).sort();
}

/** projection consumerが正規action型のまま判定できるための型guard。 */
export function isOfficialAggregationAction(
  event: OfficialAggregationEvent | null,
  action: TankActionCode,
): boolean {
  return event?.action === action;
}
