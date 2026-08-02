import { afterEach, describe, expect, it, vi } from "vitest";
import { StaffOperationError } from "@/lib/staff-operation-error";
import { buildTankRecoveryConfirmationMessage } from "@/lib/tank-recovery-confirmation-message";
import type { TankRecoveryRequirement } from "@/lib/tank-operation";
import { createTankRecoveryConfirmationResolver } from "./useTankRecoveryConfirmationResolver";

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

const SECOND_REQUIREMENT: TankRecoveryRequirement = {
  ...REQUIREMENT,
  tankId: "A-02",
  plan: {
    ...REQUIREMENT.plan,
    requiredEvidence: [
      "physicalTankConfirmed",
      "damageStateConfirmed",
    ],
  },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("tank recovery confirmation UI adapter", () => {
  it.each(["ja", "en"] as const)(
    "%s文言・1本ずつの順序・確認回数・evidence集約を維持する",
    async (locale) => {
      const confirm = vi.fn(() => true);
      vi.stubGlobal("window", { confirm });
      const resolver = createTankRecoveryConfirmationResolver(locale);

      const result = await resolver({
        fingerprint: "a".repeat(64),
        requirements: [REQUIREMENT, SECOND_REQUIREMENT],
      });

      expect(confirm.mock.calls).toEqual([
        [buildTankRecoveryConfirmationMessage(REQUIREMENT, 0, 2, locale)],
        [buildTankRecoveryConfirmationMessage(SECOND_REQUIREMENT, 1, 2, locale)],
      ]);
      expect(result).toEqual({
        fingerprint: "a".repeat(64),
        recoveryEvidence: {
          physicalTankConfirmed: true,
          possessionConfirmed: true,
          previousCustomerConfirmed: true,
          fillStateConfirmed: true,
          damageStateConfirmed: true,
        },
      });
    },
  );

  it("1本でも拒否されたらrecovery_cancelledで後続確認を止める", async () => {
    const confirm = vi.fn()
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);
    vi.stubGlobal("window", { confirm });
    const resolver = createTankRecoveryConfirmationResolver("ja");

    let error: unknown;
    try {
      await resolver({
        fingerprint: "a".repeat(64),
        requirements: [REQUIREMENT, SECOND_REQUIREMENT, REQUIREMENT],
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(StaffOperationError);
    expect((error as StaffOperationError).code).toBe("recovery_cancelled");
    expect(confirm).toHaveBeenCalledTimes(2);
  });
});
