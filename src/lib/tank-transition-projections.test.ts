import { Timestamp } from "firebase/firestore";
import { describe, expect, it } from "vitest";
import type { LogDoc } from "@/lib/firebase/repositories/types";
import {
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
  const recoveryPlan = requirePlan(planTankTransition({
    policyMode: "advisory",
    current: { status: "lent", ...customerA, location: "A社" },
    requestedAction: "order_lend",
    targetCustomer: customerB,
    targetLocation: "B社",
  }));

  it("projects all state steps and rental boundaries", () => {
    const log = makeLog(recoveryPlan, "pending");
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
    expect(projectOfficialAggregationEvent(makeLog(recoveryPlan, status)) !== null).toBe(expected);
  });

  it("uses the original business timestamp instead of reviewedAt", () => {
    const log = makeLog(recoveryPlan, "approved");
    expect(getOperationOccurredAt(log)?.toMillis()).toBe(log.originalAt?.toMillis());
    expect(projectOfficialAggregationEvent(log)?.occurredAt?.toMillis()).toBe(
      log.originalAt?.toMillis(),
    );
    expect(projectOfficialAggregationEvent(log)?.occurredAt?.toMillis()).not.toBe(
      log.reviewedAt?.toMillis(),
    );
  });

  it("preserves the visible order_lend action separately from transition action", () => {
    const log = makeLog(recoveryPlan, "approved");
    expect(log.action).toBe("order_lend");
    expect(log.transitionAction).toBe("lend");
    expect(projectOfficialAggregationEvent(log)?.action).toBe("lend");
  });
});

function requirePlan(result: ReturnType<typeof planTankTransition>): TransitionPlan {
  if (!result.ok) throw new Error(result.reason);
  return result.plan;
}

function makeLog(plan: TransitionPlan, status: TransitionReviewStatus): LogDoc {
  const originalAt = Timestamp.fromDate(new Date("2026-01-02T00:00:00+09:00"));
  const affected = deriveAffectedCustomers(plan, customerB.customerId);
  return {
    id: `relend-${status}`,
    tankId: "T001",
    action: "order_lend",
    transitionAction: "lend",
    logKind: "tank",
    logStatus: "active",
    rootLogId: `relend-${status}`,
    revision: 1,
    staffId: "staff-1",
    staffName: "担当者",
    customerId: customerB.customerId,
    customerName: customerB.customerName,
    location: "B社",
    transitionPlan: plan,
    transitionReviewStatus: status,
    policyMode: "advisory",
    policyRevision: 1,
    affectedCustomerIds: affected.affectedCustomerIds,
    hasUnknownAffectedCustomer: affected.hasUnknownAffectedCustomer,
    timestamp: originalAt,
    originalAt,
    reviewedAt: Timestamp.fromDate(new Date("2026-02-10T00:00:00+09:00")),
  };
}
