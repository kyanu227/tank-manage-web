import assert from "node:assert/strict";
import {
  createRecoveryConfirmationFingerprint,
  deriveAffectedCustomers,
  isTransitionPlan,
  normalizeTankOperationPolicy,
  planTankTransition,
  resolvePlannerPolicyMode,
  type TransitionPlan,
} from "@/lib/tank-transition-policy";

awaitMain().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function awaitMain(): Promise<void> {
const customerA = { customerId: "customer-a", customerName: "A社" };
const customerB = { customerId: "customer-b", customerName: "B社" };

const strictMismatch = planTankTransition({
  policyMode: "strict",
  current: { status: "empty" },
  requestedAction: "lend",
  targetCustomer: customerB,
});
assert.equal(strictMismatch.ok, false);
if (!strictMismatch.ok) assert.equal(strictMismatch.code, "strict_transition_required");

const emptyLend = requirePlan(planTankTransition({
  policyMode: "advisory",
  current: { status: "empty", location: "倉庫" },
  requestedAction: "lend",
  targetCustomer: customerB,
  targetLocation: "B社",
}));
assert.deepEqual(emptyLend.plan.steps.map((step) => step.action), ["fill", "lend"]);
assert.deepEqual(emptyLend.plan.requiredEvidence, [
  "physicalTankConfirmed",
  "fillStateConfirmed",
]);

const relend = requirePlan(planTankTransition({
  policyMode: "advisory",
  current: {
    status: "lent",
    customerId: customerA.customerId,
    customerName: customerA.customerName,
    location: "A社",
  },
  requestedAction: "lend",
  targetCustomer: customerB,
  targetLocation: "B社",
}));
assert.deepEqual(relend.plan.steps.map((step) => ({
  action: step.action,
  actor: step.actorType,
  effect: step.businessEffect,
})), [
  { action: "return", actor: "system", effect: "rental_close" },
  { action: "fill", actor: "system", effect: "state_only" },
  { action: "lend", actor: "operator", effect: "rental_open" },
]);
assert.deepEqual(deriveAffectedCustomers(relend.plan), {
  affectedCustomerIds: ["customer-a", "customer-b"],
  hasUnknownAffectedCustomer: false,
});

for (const status of ["damaged", "defective"] as const) {
  const blocked = planTankTransition({
    policyMode: "advisory",
    current: { status },
    requestedAction: "lend",
    targetCustomer: customerB,
  });
  assert.equal(blocked.ok, false, `${status}から貸出へ補完してはいけない`);
}

const maintenanceRecovery = planTankTransition({
  policyMode: "advisory",
  current: { status: "lent", ...customerA },
  requestedAction: "damage_report",
});
assert.equal(maintenanceRecovery.ok, false);
if (!maintenanceRecovery.ok) assert.equal(maintenanceRecovery.code, "maintenance_direct_only");

assert.equal(planTankTransition({
  policyMode: "advisory",
  current: { status: "filled" },
  requestedAction: "damage_report",
}).ok, true, "既存の直接メンテナンス遷移は維持する");

assert.equal(planTankTransition({
  policyMode: "advisory",
  current: { status: "disposed" },
  requestedAction: "inspection",
}).ok, false, "disposedは常に停止する");

assert.equal(planTankTransition({
  policyMode: "advisory",
  current: { status: "empty" },
  requestedAction: "return",
}).ok, false, "system貸出を捏造する返却recipeは作らない");

const maintenanceSystemPlan = {
  version: 1,
  kind: "recovery",
  requiredEvidence: ["physicalTankConfirmed"],
  steps: [
    {
      action: "damage_report",
      fromStatus: "filled",
      toStatus: "damaged",
      actorType: "system",
      businessEffect: "state_only",
      location: "倉庫",
    },
    {
      action: "repaired",
      fromStatus: "damaged",
      toStatus: "empty",
      actorType: "operator",
      businessEffect: "state_only",
      location: "倉庫",
    },
  ],
};
assert.equal(isTransitionPlan(maintenanceSystemPlan), false);
assert.deepEqual(normalizeTankOperationPolicy(null), {
  transitionEnforcement: "strict",
  policyRevision: 0,
});
assert.equal(resolvePlannerPolicyMode("advisory", {
  source: "manual",
  workflow: "tank_operation",
}), "advisory");
assert.equal(resolvePlannerPolicyMode("advisory", {
  source: "manual",
  workflow: "tank_operation",
}, "order_lend"), "strict", "受注貸出actionはstaff-directを偽装してもstrictへ固定する");
for (const context of [
  { source: "order_fulfillment" as const, workflow: "order" as const, transactionId: "order-1" },
  { source: "return_tag_processing" as const, workflow: "return" as const, transactionId: "return-1" },
  { source: "portal" as const, workflow: "uncharged_report" as const, transactionId: "report-1" },
]) {
  assert.equal(
    resolvePlannerPolicyMode("advisory", context),
    "strict",
    `${context.workflow} workflowはstrictへ固定する`,
  );
}

const fingerprintInput = {
  latestLogId: "log-a",
  status: "lent" as const,
  location: "A社",
  customerId: "customer-a",
  customerName: "A社",
  requestedAction: "lend" as const,
  plan: relend.plan,
  policyRevision: 8,
};
const fingerprint1 = await createRecoveryConfirmationFingerprint([
  { ...fingerprintInput, tankId: "T002" },
  { ...fingerprintInput, tankId: "T001", latestLogId: "log-b" },
]);
const fingerprint2 = await createRecoveryConfirmationFingerprint([
  { ...fingerprintInput, tankId: "T001", latestLogId: "log-b" },
  { ...fingerprintInput, tankId: "T002" },
]);
const fingerprintAfterStateChange = await createRecoveryConfirmationFingerprint([
  { ...fingerprintInput, tankId: "T001", latestLogId: "log-new" },
  { ...fingerprintInput, tankId: "T002" },
]);
assert.equal(fingerprint1, fingerprint2, "batch UI順にfingerprintを依存させない");
assert.notEqual(fingerprint1, fingerprintAfterStateChange, "latestLogId変更を検知する");

for (const [label, changed] of [
  ["location", { location: "倉庫" }],
  ["customerId", { customerId: "customer-changed" }],
  ["customerName", { customerName: "変更後顧客" }],
  ["policyRevision", { policyRevision: 9 }],
] as const) {
  const changedFingerprint = await createRecoveryConfirmationFingerprint([
    { ...fingerprintInput, tankId: "T001", latestLogId: "log-b", ...changed },
    { ...fingerprintInput, tankId: "T002" },
  ]);
  assert.notEqual(fingerprint1, changedFingerprint, `${label}変更を検知する`);
}

const unreturnedRelend = requirePlan(planTankTransition({
  policyMode: "advisory",
  current: {
    status: "unreturned",
    customerId: customerA.customerId,
    customerName: customerA.customerName,
    location: "A社",
  },
  requestedAction: "lend",
  targetCustomer: customerB,
  targetLocation: "B社",
}));
const fingerprintAfterStatusAndPlanChange = await createRecoveryConfirmationFingerprint([
  {
    ...fingerprintInput,
    tankId: "T001",
    latestLogId: "log-b",
    status: "unreturned",
    plan: unreturnedRelend.plan,
  },
  { ...fingerprintInput, tankId: "T002" },
]);
assert.notEqual(
  fingerprint1,
  fingerprintAfterStatusAndPlanChange,
  "statusと再計画後plan/requiredEvidenceの変更を検知する",
);

process.stdout.write("PASS tank transition policy matrix and fingerprint\n");
}

function requirePlan(result: ReturnType<typeof planTankTransition>): {
  plan: TransitionPlan;
} {
  if (!result.ok) throw new Error(result.reason);
  return result;
}
