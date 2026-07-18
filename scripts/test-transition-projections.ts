import assert from "node:assert/strict";
import { Timestamp } from "firebase/firestore";
import { collectBillingSourceLogMatches } from "@/lib/billing/source-logs";
import type { LogDoc } from "@/lib/firebase/repositories/types";
import {
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
const january = "2026-01";

const lendAPlan = requirePlan(planTankTransition({
  policyMode: "strict",
  current: { status: "filled" },
  requestedAction: "lend",
  targetCustomer: customerA,
  targetLocation: "A社",
}));
const relendPlan = requirePlan(planTankTransition({
  policyMode: "advisory",
  current: { status: "lent", ...customerA, location: "A社" },
  requestedAction: "lend",
  targetCustomer: customerB,
  targetLocation: "B社",
}));
const returnBPlan = requirePlan(planTankTransition({
  policyMode: "strict",
  current: { status: "lent", ...customerB, location: "B社" },
  requestedAction: "return",
  targetLocation: "倉庫",
}));

const lendA = makeLog({
  id: "lend-a",
  action: "lend",
  plan: lendAPlan,
  status: "not_required",
  at: "2026-01-01T00:00:00+09:00",
  customer: customerA,
});
const relendPending = makeLog({
  id: "relend-b",
  action: "lend",
  plan: relendPlan,
  status: "pending",
  at: "2026-01-02T00:00:00+09:00",
  customer: customerB,
});
const returnB = makeLog({
  id: "return-b",
  action: "return",
  plan: returnBPlan,
  status: "not_required",
  at: "2026-01-03T00:00:00+09:00",
});

assert.equal(projectStateTransitions(relendPending).length, 3);
assert.deepEqual(projectRentalCycleEvents(relendPending).map((event) => event.businessEffect), [
  "rental_close",
  "rental_open",
]);
assert.equal(projectOfficialAggregationEvent(relendPending), null);
assert.equal(getOperationOccurredAt(relendPending)?.toMillis(), relendPending.originalAt?.toMillis());

const pendingMatches = collectBillingSourceLogMatches(
  [returnB, relendPending, lendA],
  january,
);
assert.deepEqual(pendingMatches.map((match) => match.lendLog.id), ["lend-a"]);
assert.equal(pendingMatches[0].matchedReturn?.actionCode, "return");
assert.deepEqual(collectPendingTransitionReviewImpact([relendPending]), {
  affectedCustomerIds: ["customer-a", "customer-b"],
  hasUnknownAffectedCustomer: false,
  pendingLogIds: ["relend-b"],
});

const relendApproved: LogDoc = {
  ...relendPending,
  transitionReviewStatus: "approved",
  reviewedAt: Timestamp.fromDate(new Date("2026-02-10T00:00:00+09:00")),
};
const approvedMatches = collectBillingSourceLogMatches(
  [returnB, relendApproved, lendA],
  january,
);
assert.deepEqual(approvedMatches.map((match) => match.lendLog.id), ["lend-a", "relend-b"]);
assert.equal(approvedMatches[1].matchedReturn?.logId, "return-b");
assert.equal(
  projectOfficialAggregationEvent(relendApproved)?.occurredAt?.toMillis(),
  relendApproved.originalAt?.toMillis(),
  "reviewedAtを業務日時に使わない",
);

const carryOverPlan = requirePlan(planTankTransition({
  policyMode: "strict",
  current: { status: "lent", ...customerA, location: "A社" },
  requestedAction: "carry_over",
  targetLocation: "A社",
}));
const carryOver = makeLog({
  id: "carry-over-a",
  action: "carry_over",
  plan: carryOverPlan,
  status: "not_required",
  at: "2026-01-04T00:00:00+09:00",
});
const carryOverMatches = collectBillingSourceLogMatches([carryOver, lendA], january);
assert.equal(carryOverMatches[0].matchedReturn?.actionCode, "carry_over");

const inhouseRecoveryPlan = requirePlan(planTankTransition({
  policyMode: "advisory",
  current: { status: "in_house", location: "自社" },
  requestedAction: "fill",
  targetLocation: "倉庫",
}));
const inhouseOfficial = makeLog({
  id: "inhouse-recovery",
  action: "fill",
  plan: inhouseRecoveryPlan,
  status: "not_required",
  at: "2026-01-05T00:00:00+09:00",
});
assert.notEqual(projectOfficialAggregationEvent(inhouseOfficial), null);
assert.deepEqual(collectPendingTransitionReviewImpact([inhouseOfficial]), {
  affectedCustomerIds: [],
  hasUnknownAffectedCustomer: false,
  pendingLogIds: [],
});

process.stdout.write("PASS transition projections, billing cycles, and review timing\n");

function requirePlan(result: ReturnType<typeof planTankTransition>): TransitionPlan {
  if (!result.ok) throw new Error(result.reason);
  return result.plan;
}

function makeLog(input: {
  id: string;
  action: LogDoc["action"];
  plan: TransitionPlan;
  status: TransitionReviewStatus;
  at: string;
  customer?: typeof customerA;
}): LogDoc {
  const occurredAt = Timestamp.fromDate(new Date(input.at));
  const affected = deriveAffectedCustomers(input.plan, input.customer?.customerId);
  return {
    id: input.id,
    tankId: "T001",
    action: input.action,
    transitionAction: input.plan.steps.at(-1)?.action,
    logKind: "tank",
    logStatus: "active",
    rootLogId: input.id,
    revision: 1,
    staffId: "staff-1",
    staffName: "担当者",
    customerId: input.customer?.customerId,
    customerName: input.customer?.customerName,
    location: input.plan.steps.at(-1)?.location,
    transitionPlan: input.plan,
    transitionReviewStatus: input.status,
    policyMode: input.plan.kind === "recovery" ? "advisory" : "strict",
    policyRevision: 1,
    affectedCustomerIds: affected.affectedCustomerIds,
    hasUnknownAffectedCustomer: affected.hasUnknownAffectedCustomer,
    timestamp: occurredAt,
    originalAt: occurredAt,
  };
}
