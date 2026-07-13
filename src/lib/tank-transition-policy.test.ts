import { describe, expect, it } from "vitest";
import { getTankActionLabel } from "@/lib/tank-action-status-labels";
import {
  createRecoveryConfirmationFingerprint,
  deriveAffectedCustomers,
  isStaffDirectAdvisoryContext,
  normalizeTankOperationPolicy,
  planTankTransition,
  resolvePlannerPolicyMode,
  resolveRuntimeTransitionEnforcement,
  type TransitionPlan,
} from "@/lib/tank-transition-policy";

const customerA = { customerId: "customer-a", customerName: "A社" };
const customerB = { customerId: "customer-b", customerName: "B社" };

describe("tank transition planner", () => {
  it("creates a direct plan for a valid transition", () => {
    const result = requirePlan(planTankTransition({
      policyMode: "strict",
      current: { status: "filled", location: "倉庫" },
      requestedAction: "lend",
      targetCustomer: customerB,
      targetLocation: "B社",
    }));

    expect(result.plan.kind).toBe("direct");
    expect(result.plan.steps.map((step) => step.action)).toEqual(["lend"]);
    expect(result.plan.requiredEvidence).toEqual([]);
  });

  it("hard-blocks an invalid strict transition", () => {
    const result = planTankTransition({
      policyMode: "strict",
      current: { status: "empty", location: "倉庫" },
      requestedAction: "lend",
      targetCustomer: customerB,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("strict_transition_required");
  });

  it("expands empty -> fill -> lend", () => {
    const result = requirePlan(planTankTransition({
      policyMode: "advisory",
      current: { status: "empty", location: "倉庫" },
      requestedAction: "lend",
      targetCustomer: customerB,
      targetLocation: "B社",
    }));

    expect(result.plan.steps.map((step) => step.action)).toEqual(["fill", "lend"]);
    expect(result.plan.requiredEvidence).toEqual([
      "physicalTankConfirmed",
      "fillStateConfirmed",
    ]);
  });

  it("expands lent -> return -> fill -> lend with both customers", () => {
    const result = requirePlan(planTankTransition({
      policyMode: "advisory",
      current: { status: "lent", ...customerA, location: "A社" },
      requestedAction: "lend",
      targetCustomer: customerB,
      targetLocation: "B社",
    }));

    expect(result.transitionAction).toBe("lend");
    expect(result.plan.steps.map((step) => step.action)).toEqual(["return", "fill", "lend"]);
    expect(result.plan.requiredEvidence).toContain("previousCustomerConfirmed");
    expect(deriveAffectedCustomers(result.plan)).toEqual({
      affectedCustomerIds: ["customer-a", "customer-b"],
      hasUnknownAffectedCustomer: false,
    });
  });

  it("expands in_house -> inhouse_return -> fill -> lend", () => {
    const result = requirePlan(planTankTransition({
      policyMode: "advisory",
      current: { status: "in_house", location: "自社" },
      requestedAction: "lend",
      targetCustomer: customerB,
      targetLocation: "B社",
    }));

    expect(result.plan.steps.map((step) => step.action)).toEqual([
      "inhouse_return",
      "fill",
      "lend",
    ]);
  });

  it("never recovers maintenance operations", () => {
    const result = planTankTransition({
      policyMode: "advisory",
      current: { status: "lent", ...customerA, location: "A社" },
      requestedAction: "damage_report",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("maintenance_direct_only");
  });

  it("hard-blocks disposed tanks", () => {
    const result = planTankTransition({
      policyMode: "advisory",
      current: { status: "disposed" },
      requestedAction: "inspection",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("disposed");
  });

  it("keeps order_lend as the visible action while normalizing its transition", () => {
    const result = requirePlan(planTankTransition({
      policyMode: "strict",
      current: { status: "filled", location: "倉庫" },
      requestedAction: "order_lend",
      targetCustomer: customerB,
      targetLocation: "B社",
    }));

    expect(getTankActionLabel("order_lend", "ja")).toBe("受注貸出");
    expect(result.transitionAction).toBe("lend");
    expect(result.plan.steps.at(-1)?.action).toBe("lend");
  });

  it("never creates an order_lend recovery even when advisory is passed directly", () => {
    const result = planTankTransition({
      policyMode: "advisory",
      current: { status: "empty", location: "倉庫" },
      requestedAction: "order_lend",
      targetCustomer: customerB,
      targetLocation: "B社",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("strict_transition_required");
  });
});

describe("advisory operation scope", () => {
  it.each([
    { source: "manual" as const, workflow: "tank_operation" as const },
    { source: "bulk_return" as const, workflow: "tank_operation" as const },
  ])("allows explicit staff-direct context: $source", (context) => {
    expect(isStaffDirectAdvisoryContext(context)).toBe(true);
    expect(resolvePlannerPolicyMode("advisory", context, undefined, true)).toBe("advisory");
  });

  it.each([
    { source: "order_fulfillment" as const, workflow: "order" as const, transactionId: "order-1" },
    { source: "return_tag_processing" as const, workflow: "return" as const, transactionId: "return-1" },
    { source: "portal" as const, workflow: "uncharged_report" as const, transactionId: "report-1" },
    { source: "manual" as const, workflow: "tank_operation" as const, transactionId: "unexpected" },
    {},
  ])("keeps customer/transaction/unspecified context strict: %#", (context) => {
    expect(isStaffDirectAdvisoryContext(context)).toBe(false);
    expect(resolvePlannerPolicyMode("advisory", context, undefined, true)).toBe("strict");
  });

  it("keeps every context strict when the configured policy is strict", () => {
    expect(resolvePlannerPolicyMode("strict", {
      source: "manual",
      workflow: "tank_operation",
    }, undefined, true)).toBe("strict");
  });

  it("keeps order_lend strict even if a caller labels it as staff-direct", () => {
    expect(resolvePlannerPolicyMode("advisory", {
      source: "manual",
      workflow: "tank_operation",
    }, "order_lend", true)).toBe("strict");
  });

  it("keeps configured advisory separate when the rollout gate forces runtime strict", () => {
    const configured = normalizeTankOperationPolicy({
      transitionEnforcement: "advisory",
      policyRevision: 2,
    });
    expect(configured.transitionEnforcement).toBe("advisory");
    expect(resolveRuntimeTransitionEnforcement("advisory", false)).toBe("strict");
    expect(resolveRuntimeTransitionEnforcement("advisory", true)).toBe("advisory");
    expect(resolvePlannerPolicyMode("advisory", {
      source: "manual",
      workflow: "tank_operation",
    }, undefined, false)).toBe("strict");
  });
});

describe("recovery confirmation fingerprint", () => {
  it("is canonical across batch order and changes with audited state", async () => {
    const plan = requirePlan(planTankTransition({
      policyMode: "advisory",
      current: { status: "lent", ...customerA, location: "A社" },
      requestedAction: "lend",
      targetCustomer: customerB,
      targetLocation: "B社",
    })).plan;
    const base = {
      latestLogId: "log-a",
      status: "lent" as const,
      location: "A社",
      customerId: customerA.customerId,
      customerName: customerA.customerName,
      requestedAction: "lend" as const,
      plan,
      policyRevision: 8,
    };

    const first = await createRecoveryConfirmationFingerprint([
      { ...base, tankId: "T002" },
      { ...base, tankId: "T001", latestLogId: "log-b" },
    ]);
    const reordered = await createRecoveryConfirmationFingerprint([
      { ...base, tankId: "T001", latestLogId: "log-b" },
      { ...base, tankId: "T002" },
    ]);
    const changedCustomer = await createRecoveryConfirmationFingerprint([
      { ...base, tankId: "T001", latestLogId: "log-b", customerId: "customer-c" },
      { ...base, tankId: "T002" },
    ]);

    expect(first).toBe(reordered);
    expect(first).not.toBe(changedCustomer);
  });

  it("latestLog/status/location/customer/policy/plan/requiredEvidenceの変更を検知する", async () => {
    const plan = requirePlan(planTankTransition({
      policyMode: "advisory",
      current: { status: "lent", ...customerA, location: "A社" },
      requestedAction: "lend",
      targetCustomer: customerB,
      targetLocation: "B社",
    })).plan;
    const base = {
      tankId: "T001",
      latestLogId: "log-a",
      status: "lent" as const,
      location: "A社",
      customerId: customerA.customerId,
      customerName: customerA.customerName,
      requestedAction: "lend" as const,
      plan,
      policyRevision: 8,
    };
    const original = await createRecoveryConfirmationFingerprint([base]);

    for (const changed of [
      { ...base, latestLogId: "log-b" },
      { ...base, location: "倉庫" },
      { ...base, customerId: "customer-c" },
      { ...base, customerName: "変更後顧客" },
      { ...base, policyRevision: 9 },
    ]) {
      await expect(createRecoveryConfirmationFingerprint([changed]))
        .resolves.not.toBe(original);
    }

    const changedStatusPlan = requirePlan(planTankTransition({
      policyMode: "advisory",
      current: { status: "unreturned", ...customerA, location: "A社" },
      requestedAction: "lend",
      targetCustomer: customerB,
      targetLocation: "B社",
    })).plan;
    await expect(createRecoveryConfirmationFingerprint([{
      ...base,
      status: "unreturned",
      plan: changedStatusPlan,
    }])).resolves.not.toBe(original);

    const invalidEvidencePlan = {
      ...plan,
      requiredEvidence: plan.requiredEvidence.filter(
        (key) => key !== "previousCustomerConfirmed",
      ),
    };
    await expect(createRecoveryConfirmationFingerprint([{
      ...base,
      plan: invalidEvidencePlan as TransitionPlan,
    }])).rejects.toThrow("transitionPlanが不正です");
  });
});

function requirePlan(result: ReturnType<typeof planTankTransition>): {
  plan: TransitionPlan;
  transitionAction: string;
} {
  if (!result.ok) throw new Error(result.reason);
  return result;
}
