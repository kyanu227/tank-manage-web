import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OperationActor } from "@/lib/operation-context";
import { applyTankOperation } from "@/lib/tank-operation";
import { submitInHouseUseReport } from "@/features/inhouse/services/inhouse-use-workflow";

vi.mock("@/lib/tank-operation", () => ({
  applyTankOperation: vi.fn(),
}));

const ACTOR = {
  staffId: "staff-001",
  staffName: "山田 太郎",
  staffEmail: "yamada@example.com",
  role: "worker",
  rank: "A",
} satisfies OperationActor;

const UNDEFINED_RECOVERY_OPTIONS = {
  recoveryConfirmationResolver: undefined,
};

const applyTankOperationMock = vi.mocked(applyTankOperation);

describe("submitInHouseUseReport", () => {
  beforeEach(() => {
    applyTankOperationMock.mockReset();
  });

  it("emptyのcurrentStatusを従来どおりのpayloadで送信する", async () => {
    await submitInHouseUseReport({
      tankId: "A01",
      currentStatus: "empty",
      actor: ACTOR,
    });

    expect(applyTankOperationMock).toHaveBeenCalledTimes(1);
    expect(applyTankOperationMock.mock.calls[0]).toEqual([
      {
        tankId: "A01",
        transitionAction: "自社利用(事後)",
        currentStatus: "empty",
        context: {
          actor: ACTOR,
          source: "manual",
          workflow: "tank_operation",
        },
        location: "自社",
      logNote: "事後報告",
    },
    UNDEFINED_RECOVERY_OPTIONS,
  ]);

    const [operation] = applyTankOperationMock.mock.calls[0];
    expect(Object.keys(operation).sort()).toEqual([
      "context",
      "currentStatus",
      "location",
      "logNote",
      "tankId",
      "transitionAction",
    ]);
    expect(Object.keys(operation.context)).toEqual([
      "actor",
      "source",
      "workflow",
    ]);
    expect([
      "tankNote" in operation,
      "tankExtra" in operation,
      "logExtra" in operation,
      "logAction" in operation,
      "provenance" in operation,
      "customer" in operation.context,
      "transactionId" in operation.context,
      "returnCondition" in operation.context,
      "provenance" in operation.context,
    ]).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it("filledのcurrentStatusも変更せず同じpayload構造で送信する", async () => {
    await submitInHouseUseReport({
      tankId: "B02",
      currentStatus: "filled",
      actor: ACTOR,
    });

    expect(applyTankOperationMock).toHaveBeenCalledTimes(1);
    expect(applyTankOperationMock.mock.calls[0]).toEqual([
      {
        tankId: "B02",
        transitionAction: "自社利用(事後)",
        currentStatus: "filled",
        context: {
          actor: ACTOR,
          source: "manual",
          workflow: "tank_operation",
        },
        location: "自社",
      logNote: "事後報告",
    },
    UNDEFINED_RECOVERY_OPTIONS,
  ]);

    const [operation] = applyTankOperationMock.mock.calls[0];
    expect(Object.keys(operation).sort()).toEqual([
      "context",
      "currentStatus",
      "location",
      "logNote",
      "tankId",
      "transitionAction",
    ]);
    expect(Object.keys(operation.context)).toEqual([
      "actor",
      "source",
      "workflow",
    ]);
    expect([
      "tankNote" in operation,
      "tankExtra" in operation,
      "logExtra" in operation,
      "logAction" in operation,
      "provenance" in operation,
      "customer" in operation.context,
      "transactionId" in operation.context,
      "returnCondition" in operation.context,
      "provenance" in operation.context,
    ]).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
  });
});
