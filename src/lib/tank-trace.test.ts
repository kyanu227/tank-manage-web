import { describe, expect, it } from "vitest";
import { isOfficialFillSource } from "@/lib/tank-trace";
import { planTankTransition, type TransitionPlan } from "@/lib/tank-transition-policy";

const customer = { customerId: "customer-a", customerName: "A社" };

describe("underfilled source eligibility", () => {
  it("accepts a direct operator fill", () => {
    const plan = requirePlan(planTankTransition({
      policyMode: "strict",
      current: { status: "empty", location: "倉庫" },
      requestedAction: "fill",
      targetLocation: "倉庫",
    }));
    expect(isOfficialFillSource({
      transitionPlan: plan,
      transitionReviewStatus: "not_required",
    })).toBe(true);
  });

  it("does not assign a recovery system fill to the lend operator", () => {
    const plan = requirePlan(planTankTransition({
      policyMode: "advisory",
      current: { status: "empty", location: "倉庫" },
      requestedAction: "lend",
      targetCustomer: customer,
      targetLocation: customer.customerName,
    }));
    expect(isOfficialFillSource({
      transitionPlan: plan,
      transitionReviewStatus: "approved",
    })).toBe(false);
  });

  it("accepts an approved recovery whose final operator action is fill", () => {
    const plan = requirePlan(planTankTransition({
      policyMode: "advisory",
      current: { status: "lent", ...customer, location: customer.customerName },
      requestedAction: "fill",
      targetLocation: "倉庫",
    }));
    expect(isOfficialFillSource({
      transitionPlan: plan,
      transitionReviewStatus: "approved",
    })).toBe(true);
    expect(isOfficialFillSource({
      transitionPlan: plan,
      transitionReviewStatus: "pending",
    })).toBe(false);
  });
});

function requirePlan(result: ReturnType<typeof planTankTransition>): TransitionPlan {
  if (!result.ok) throw new Error(result.reason);
  return result.plan;
}
