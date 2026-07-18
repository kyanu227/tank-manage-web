import { Timestamp } from "firebase/firestore";
import { describe, expect, it } from "vitest";
import type { LogDoc } from "@/lib/firebase/repositories/types";
import {
  assertOfficialAggregationSchemaReady,
  collectPendingTransitionReviewImpact,
  getOperationOccurredAt,
  projectOfficialAggregationEvent,
  projectRentalCycleEvents,
  projectStateTransitions,
} from "@/lib/tank-transition-projections";
import {
  deriveAffectedCustomers,
  planTankTransition,
  type TransitionPlan,
  type TransitionReviewStatus,
} from "@/lib/tank-transition-policy";

const customerA = { customerId: "customer-a", customerName: "A社" };
const customerB = { customerId: "customer-b", customerName: "B社" };

describe("transition projections", () => {
  const externalRecoveryPlan = requirePlan(planTankTransition({
    policyMode: "advisory",
    current: { status: "lent", ...customerA, location: "A社" },
    requestedAction: "lend",
    targetCustomer: customerB,
    targetLocation: "B社",
  }));
  const internalRecoveryPlan = requirePlan(planTankTransition({
    policyMode: "advisory",
    current: { status: "in_house", location: "自社" },
    requestedAction: "fill",
    targetLocation: "倉庫",
  }));

  it("projects all state steps and rental boundaries", () => {
    const log = makeLog(externalRecoveryPlan, "pending");
    expect(projectStateTransitions(log).map((event) => event.action)).toEqual([
      "return",
      "fill",
      "lend",
    ]);
    expect(projectRentalCycleEvents(log).map((event) => event.businessEffect)).toEqual([
      "rental_close",
      "rental_open",
    ]);
  });

  it.each([
    ["pending", false],
    ["approved", true],
    ["excluded", false],
  ] as const)("projects official aggregation for %s = %s", (status, expected) => {
    expect(
      projectOfficialAggregationEvent(makeLog(externalRecoveryPlan, status)) !== null,
    ).toBe(expected);
  });

  it("projects internal recovery immediately when review is not required", () => {
    const log = makeLog(internalRecoveryPlan, "not_required");
    expect(projectOfficialAggregationEvent(log)?.action).toBe("fill");
    expect(projectOfficialAggregationEvent(log)?.occurredAt?.toMillis()).toBe(
      log.originalAt?.toMillis(),
    );
  });

  it("blocks only customers affected by an external pending recovery", () => {
    const externalPending = makeLog(externalRecoveryPlan, "pending");
    const internalOfficial = makeLog(internalRecoveryPlan, "not_required");
    expect(collectPendingTransitionReviewImpact([
      internalOfficial,
      externalPending,
    ])).toEqual({
      affectedCustomerIds: ["customer-a", "customer-b"],
      hasUnknownAffectedCustomer: false,
      pendingLogIds: [externalPending.id],
    });
    expect(collectPendingTransitionReviewImpact([internalOfficial])).toEqual({
      affectedCustomerIds: [],
      hasUnknownAffectedCustomer: false,
      pendingLogIds: [],
    });
  });

  it.each(["voided", "superseded"] as const)(
    "does not project a %s log into official aggregation",
    (logStatus) => {
      expect(projectOfficialAggregationEvent(makeLog(
        internalRecoveryPlan,
        "not_required",
        { logStatus },
      ))).toBeNull();
    },
  );

  it("fails closed for review statuses that contradict recovery impact", () => {
    expect(() => assertOfficialAggregationSchemaReady([
      makeLog(internalRecoveryPlan, "pending"),
    ])).toThrow("transitionPlan必須schemaへ未移行");
    expect(() => assertOfficialAggregationSchemaReady([
      makeLog(externalRecoveryPlan, "not_required"),
    ])).toThrow("transitionPlan必須schemaへ未移行");
  });

  it("uses the original business timestamp instead of reviewedAt", () => {
    const log = makeLog(externalRecoveryPlan, "approved");
    expect(getOperationOccurredAt(log)?.toMillis()).toBe(log.originalAt?.toMillis());
    expect(projectOfficialAggregationEvent(log)?.occurredAt?.toMillis()).toBe(
      log.originalAt?.toMillis(),
    );
    expect(projectOfficialAggregationEvent(log)?.occurredAt?.toMillis()).not.toBe(
      log.reviewedAt?.toMillis(),
    );
  });

  it("preserves the visible order_lend action separately from transition action", () => {
    const log = makeLog(externalRecoveryPlan, "approved", { action: "order_lend" });
    expect(log.action).toBe("order_lend");
    expect(log.transitionAction).toBe("lend");
    expect(projectOfficialAggregationEvent(log)?.action).toBe("lend");
  });

  it("fails closed when an active tank log has not migrated to the required schema", () => {
    const migrated = makeLog(externalRecoveryPlan, "approved");
    expect(() => assertOfficialAggregationSchemaReady([migrated])).not.toThrow();
    expect(() => assertOfficialAggregationSchemaReady([{
      ...migrated,
      id: "legacy-log",
      transitionPlan: undefined,
      transitionReviewStatus: undefined,
    }])).toThrow("transitionPlan必須schemaへ未移行");
    expect(() => assertOfficialAggregationSchemaReady([{
      ...migrated,
      id: "legacy-kindless-log",
      logKind: "",
      transitionPlan: undefined,
    }])).toThrow("transitionPlan必須schemaへ未移行");
  });
});

function requirePlan(result: ReturnType<typeof planTankTransition>): TransitionPlan {
  if (!result.ok) throw new Error(result.reason);
  return result.plan;
}

function makeLog(
  plan: TransitionPlan,
  status: TransitionReviewStatus,
  options: {
    action?: string;
    logStatus?: LogDoc["logStatus"];
    hasUnknownAffectedCustomer?: boolean;
  } = {},
): LogDoc {
  const originalAt = Timestamp.fromDate(new Date("2026-01-02T00:00:00+09:00"));
  const finalStep = plan.steps.at(-1)!;
  const affected = deriveAffectedCustomers(plan, finalStep.customerId);
  const id = `${finalStep.action}-${status}`;
  return {
    id,
    tankId: "T001",
    action: options.action ?? finalStep.action,
    transitionAction: finalStep.action,
    logKind: "tank",
    logStatus: options.logStatus ?? "active",
    rootLogId: id,
    revision: 1,
    staffId: "staff-1",
    staffName: "担当者",
    customerId: finalStep.customerId,
    customerName: finalStep.customerName,
    location: finalStep.location,
    transitionPlan: plan,
    transitionReviewStatus: status,
    policyMode: "advisory",
    policyRevision: 1,
    affectedCustomerIds: affected.affectedCustomerIds,
    hasUnknownAffectedCustomer:
      options.hasUnknownAffectedCustomer ?? affected.hasUnknownAffectedCustomer,
    timestamp: originalAt,
    originalAt,
    reviewedAt: Timestamp.fromDate(new Date("2026-02-10T00:00:00+09:00")),
  };
}
