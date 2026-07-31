import { describe, expect, it } from "vitest";
import type { TankRecoveryRequirement } from "./tank-operation";
import { buildTankRecoveryConfirmationMessage } from "./tank-recovery-confirmation-message";

const REQUIREMENT: TankRecoveryRequirement = {
  tankId: "A-01",
  currentStatus: "lent",
  currentLocation: "Customer A",
  currentCustomerId: "customer-a",
  currentCustomerName: "Customer A",
  requestedAction: "lend",
  transitionReviewStatus: "pending",
  plan: {
    version: 1,
    kind: "recovery",
    steps: [
      {
        action: "return",
        fromStatus: "lent",
        toStatus: "empty",
        actorType: "system",
        businessEffect: "rental_close",
        customerId: "customer-a",
        customerName: "Customer A",
        location: "倉庫",
      },
      {
        action: "fill",
        fromStatus: "empty",
        toStatus: "filled",
        actorType: "system",
        businessEffect: "state_only",
        location: "倉庫",
      },
      {
        action: "lend",
        fromStatus: "filled",
        toStatus: "lent",
        actorType: "operator",
        businessEffect: "rental_open",
        customerId: "customer-b",
        customerName: "Customer B",
        location: "Customer B",
      },
    ],
    requiredEvidence: [
      "physicalTankConfirmed",
      "possessionConfirmed",
      "previousCustomerConfirmed",
      "fillStateConfirmed",
    ],
  },
};

describe("tank recovery confirmation message", () => {
  it("preserves the existing Japanese detail and canonical codes", () => {
    const message = buildTankRecoveryConfirmationMessage(REQUIREMENT, 0, 1, "ja");

    expect(message).toContain("状態遷移の自動補完を実行します（1/1）。");
    expect(message).toContain("表示操作: 貸出 (lend)");
    expect(message).toContain("現在status: 貸出中 (lent)");
    expect(message).toContain("場所: 倉庫");
    expect(message).toContain("・目の前の現物と、表示されたタンクID/番号が一致する [physicalTankConfirmed]");
  });

  it("localizes only display copy and preserves IDs, names, and canonical codes", () => {
    const message = buildTankRecoveryConfirmationMessage(REQUIREMENT, 0, 1, "en");

    expect(message).toContain("Run state-transition recovery (1/1).");
    expect(message).toContain("Displayed operation: Lend (lend)");
    expect(message).toContain("Current status: Lent (lent)");
    expect(message).toContain("Location: Warehouse");
    expect(message).toContain("Customer A (customerId: customer-a)");
    expect(message).toContain("Customer B (customerId: customer-b)");
    expect(message).toContain("[physicalTankConfirmed]");
    expect(message).not.toMatch(/[\u3040-\u30ff\u3400-\u9fff々〆〤ヶ]/u);
  });

  it("preserves customer-name collisions while translating confirmed system locations", () => {
    const message = buildTankRecoveryConfirmationMessage({
      ...REQUIREMENT,
      currentLocation: "倉庫",
      currentCustomerId: "customer-warehouse",
      currentCustomerName: "倉庫",
      plan: {
        ...REQUIREMENT.plan,
        steps: REQUIREMENT.plan.steps.map((step) => (
          step.businessEffect === "rental_open"
            ? { ...step, customerName: "自社", location: "自社" }
            : step
        )),
      },
    }, 0, 1, "en");

    expect(message).toContain("Current location: 倉庫");
    expect(message).toContain("Location: Warehouse");
    expect(message).toContain("Location: 自社");
  });

  it("does not expose an unknown system location in English", () => {
    const message = buildTankRecoveryConfirmationMessage({
      ...REQUIREMENT,
      plan: {
        ...REQUIREMENT.plan,
        steps: REQUIREMENT.plan.steps.map((step, index) => (
          index === 1 ? { ...step, location: "未知場所" } : step
        )),
      },
    }, 0, 1, "en");

    expect(message).toContain("Location: Unknown location");
    expect(message).not.toContain("未知場所");
  });

  it("uses the current status before stale customer metadata", () => {
    const message = buildTankRecoveryConfirmationMessage({
      ...REQUIREMENT,
      currentStatus: "empty",
      currentLocation: "倉庫",
    }, 0, 1, "en");

    expect(message).toContain("Current location: Warehouse");
  });
});
