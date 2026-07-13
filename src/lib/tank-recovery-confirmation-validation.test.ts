import { describe, expect, it } from "vitest";
import { assertRecoveryConfirmationsMatchReplannedState } from "@/lib/tank-recovery-confirmation-validation";
import { planTankTransition } from "@/lib/tank-transition-policy";

describe("assertRecoveryConfirmationsMatchReplannedState", () => {
  it("形式が正しい64hexでも再計画後fingerprintと不一致ならhard abortする", () => {
    const result = planTankTransition({
      policyMode: "advisory",
      current: { status: "empty", location: "倉庫" },
      requestedAction: "lend",
      targetCustomer: { customerId: "customer-a", customerName: "A社" },
      targetLocation: "A社",
    });
    if (!result.ok) throw new Error(result.reason);

    expect(() => assertRecoveryConfirmationsMatchReplannedState([{
      tankId: "A-01",
      plan: result.plan,
      expectedFingerprint: "a".repeat(64),
      confirmation: {
        fingerprint: "b".repeat(64),
        recoveryEvidence: {
          physicalTankConfirmed: true,
          fillStateConfirmed: true,
        },
      },
    }])).toThrow("確認後にタンク状態");
  });

  it("理由なしでもplanner要求の証跡とfingerprintが一致すれば確認済みとする", () => {
    const result = planTankTransition({
      policyMode: "advisory",
      current: { status: "empty", location: "倉庫" },
      requestedAction: "lend",
      targetCustomer: { customerId: "customer-a", customerName: "A社" },
      targetLocation: "A社",
    });
    if (!result.ok) throw new Error(result.reason);

    expect(assertRecoveryConfirmationsMatchReplannedState([{
      tankId: "A-01",
      plan: result.plan,
      expectedFingerprint: "a".repeat(64),
      confirmation: {
        fingerprint: "a".repeat(64),
        recoveryEvidence: {
          physicalTankConfirmed: true,
          fillStateConfirmed: true,
        },
      },
    }])).toBe(true);
  });

  it("理由を要求せずplanner要求の証跡不足だけをhard abortする", () => {
    const result = planTankTransition({
      policyMode: "advisory",
      current: { status: "empty", location: "倉庫" },
      requestedAction: "lend",
      targetCustomer: { customerId: "customer-a", customerName: "A社" },
      targetLocation: "A社",
    });
    if (!result.ok) throw new Error(result.reason);

    expect(() => assertRecoveryConfirmationsMatchReplannedState([{
      tankId: "A-01",
      plan: result.plan,
      expectedFingerprint: "a".repeat(64),
      confirmation: {
        fingerprint: "a".repeat(64),
        recoveryEvidence: { physicalTankConfirmed: true },
      },
    }])).toThrow("plannerが要求した確認項目");
  });
});
