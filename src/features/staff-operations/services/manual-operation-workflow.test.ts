import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireStaffIdentity } from "@/hooks/useStaffSession";
import type {
  CustomerSnapshot,
  OperationActor,
} from "@/lib/operation-context";
import { applyBulkTankOperations } from "@/lib/tank-operation";
import type { ReturnTag } from "@/lib/tank-rules";
import type { TankMap } from "@/features/staff-operations/types";
import { submitManualTankOperation } from "@/features/staff-operations/services/manual-operation-workflow";

vi.mock("@/lib/tank-operation", () => ({
  applyBulkTankOperations: vi.fn(),
}));

vi.mock("@/hooks/useStaffSession", () => ({
  requireStaffIdentity: vi.fn(),
}));

const ACTOR = {
  staffId: "staff-001",
  staffName: "山田 太郎",
  staffEmail: "yamada@example.com",
  role: "worker",
  rank: "A",
} satisfies OperationActor;

const CUSTOMER = {
  customerId: "customer-001",
  customerName: "テストダイビング",
} satisfies CustomerSnapshot;

const applyBulkTankOperationsMock = vi.mocked(applyBulkTankOperations);
const requireStaffIdentityMock = vi.mocked(requireStaffIdentity);

type CapturedOperation = Parameters<typeof applyBulkTankOperations>[0][number];

function expectPayloadShape(
  operations: CapturedOperation[],
  contextKeys: string[],
): void {
  for (const operation of operations) {
    expect(Object.keys(operation).sort()).toEqual([
      "context",
      "currentStatus",
      "location",
      "logNote",
      "tankId",
      "tankNote",
      "transitionAction",
    ]);
    expect(Object.keys(operation.context)).toEqual(contextKeys);
    expect(operation.context.source).toBe("manual");
    expect(operation.context.workflow).toBe("tank_operation");

    for (const key of [
      "provenance",
      "transactionId",
      "tankExtra",
      "logExtra",
      "logAction",
      "returnTag",
    ]) {
      expect(key in operation).toBe(false);
      expect(key in operation.context).toBe(false);
    }
  }
}

describe("submitManualTankOperation", () => {
  beforeEach(() => {
    applyBulkTankOperationsMock.mockReset();
    applyBulkTankOperationsMock.mockResolvedValue([]);
    requireStaffIdentityMock.mockReset();
    requireStaffIdentityMock.mockReturnValue(ACTOR);
  });

  it("lendの複数タンクを入力順とraw statusを保ったpayloadで一括送信する", async () => {
    await submitManualTankOperation({
      mode: "lend",
      items: [
        { tankId: "A-01", status: "充填済み", tag: "normal" },
        { tankId: "B-02", status: "filled", tag: "unused" },
      ],
      customer: CUSTOMER,
      tanks: {},
    });

    expect(requireStaffIdentityMock).toHaveBeenCalledTimes(1);
    expect(applyBulkTankOperationsMock).toHaveBeenCalledTimes(1);
    expect(applyBulkTankOperationsMock.mock.calls[0]).toEqual([
      [
        {
          tankId: "A-01",
          transitionAction: "lend",
          currentStatus: "充填済み",
          context: {
            actor: ACTOR,
            source: "manual",
            workflow: "tank_operation",
            customer: CUSTOMER,
          },
          location: "テストダイビング",
          tankNote: "",
          logNote: "",
        },
        {
          tankId: "B-02",
          transitionAction: "lend",
          currentStatus: "filled",
          context: {
            actor: ACTOR,
            source: "manual",
            workflow: "tank_operation",
            customer: CUSTOMER,
          },
          location: "テストダイビング",
          tankNote: "",
          logNote: "",
        },
      ],
    ]);

    expectPayloadShape(
      applyBulkTankOperationsMock.mock.calls[0][0],
      ["actor", "source", "workflow", "customer"],
    );
  });

  it("fillではcustomerとreturnConditionを含めず倉庫向けpayloadを送信する", async () => {
    await submitManualTankOperation({
      mode: "fill",
      items: [
        { tankId: "C-03", status: "空", tag: "keep" },
      ],
      customer: CUSTOMER,
      tanks: {},
    });

    expect(requireStaffIdentityMock).toHaveBeenCalledTimes(1);
    expect(applyBulkTankOperationsMock).toHaveBeenCalledTimes(1);
    expect(applyBulkTankOperationsMock.mock.calls[0]).toEqual([
      [
        {
          tankId: "C-03",
          transitionAction: "fill",
          currentStatus: "空",
          context: {
            actor: ACTOR,
            source: "manual",
            workflow: "tank_operation",
          },
          location: "倉庫",
          tankNote: "",
          logNote: "",
        },
      ],
    ]);

    expectPayloadShape(
      applyBulkTankOperationsMock.mock.calls[0][0],
      ["actor", "source", "workflow"],
    );
  });

  it("returnの全tagをstatus別action・note・conditionへ変換して入力順に一括送信する", async () => {
    const tanks = {
      "G-07": {
        id: "G-07",
        status: "貸出中",
        location: "現場保管庫",
      },
    } satisfies TankMap;

    await submitManualTankOperation({
      mode: "return",
      items: [
        { tankId: "A-01", status: "貸出中", tag: "normal" },
        { tankId: "B-02", status: "in_house", tag: "normal" },
        { tankId: "C-03", status: "lent", tag: "unused" },
        { tankId: "D-04", status: "自社利用中", tag: "unused" },
        { tankId: "E-05", status: "未返却", tag: "uncharged" },
        { tankId: "F-06", status: "in_house", tag: "uncharged" },
        { tankId: "G-07", status: "lent", tag: "keep" },
        { tankId: "H-08", status: "貸出中", tag: "" as ReturnTag },
      ],
      customer: CUSTOMER,
      tanks,
    });

    expect(requireStaffIdentityMock).toHaveBeenCalledTimes(1);
    expect(applyBulkTankOperationsMock).toHaveBeenCalledTimes(1);
    expect(applyBulkTankOperationsMock.mock.calls[0]).toEqual([
      [
        {
          tankId: "A-01",
          transitionAction: "return",
          currentStatus: "貸出中",
          context: {
            actor: ACTOR,
            source: "manual",
            workflow: "tank_operation",
            returnCondition: "normal",
          },
          location: "倉庫",
          tankNote: "",
          logNote: "",
        },
        {
          tankId: "B-02",
          transitionAction: "inhouse_return",
          currentStatus: "in_house",
          context: {
            actor: ACTOR,
            source: "manual",
            workflow: "tank_operation",
            returnCondition: "normal",
          },
          location: "倉庫",
          tankNote: "",
          logNote: "",
        },
        {
          tankId: "C-03",
          transitionAction: "return_unused",
          currentStatus: "lent",
          context: {
            actor: ACTOR,
            source: "manual",
            workflow: "tank_operation",
            returnCondition: "unused",
          },
          location: "倉庫",
          tankNote: "[TAG:unused]",
          logNote: "[TAG:unused]",
        },
        {
          tankId: "D-04",
          transitionAction: "inhouse_return_unused",
          currentStatus: "自社利用中",
          context: {
            actor: ACTOR,
            source: "manual",
            workflow: "tank_operation",
            returnCondition: "unused",
          },
          location: "倉庫",
          tankNote: "[TAG:unused]",
          logNote: "[TAG:unused]",
        },
        {
          tankId: "E-05",
          transitionAction: "return_uncharged",
          currentStatus: "未返却",
          context: {
            actor: ACTOR,
            source: "manual",
            workflow: "tank_operation",
            returnCondition: "uncharged",
          },
          location: "倉庫",
          tankNote: "[TAG:uncharged]",
          logNote: "[TAG:uncharged]",
        },
        {
          tankId: "F-06",
          transitionAction: "inhouse_return_uncharged",
          currentStatus: "in_house",
          context: {
            actor: ACTOR,
            source: "manual",
            workflow: "tank_operation",
            returnCondition: "uncharged",
          },
          location: "倉庫",
          tankNote: "[TAG:uncharged]",
          logNote: "[TAG:uncharged]",
        },
        {
          tankId: "G-07",
          transitionAction: "carry_over",
          currentStatus: "lent",
          context: {
            actor: ACTOR,
            source: "manual",
            workflow: "tank_operation",
            returnCondition: "keep",
          },
          location: "現場保管庫",
          tankNote: "",
          logNote: "持ち越し",
        },
        {
          tankId: "H-08",
          transitionAction: "return",
          currentStatus: "貸出中",
          context: {
            actor: ACTOR,
            source: "manual",
            workflow: "tank_operation",
            returnCondition: "normal",
          },
          location: "倉庫",
          tankNote: "",
          logNote: "",
        },
      ],
    ]);

    expectPayloadShape(
      applyBulkTankOperationsMock.mock.calls[0][0],
      ["actor", "source", "workflow", "returnCondition"],
    );
  });

  it("KEEPのlocationは現在値を使い、空または未登録なら不明へfallbackする", async () => {
    const tanks = {
      "KEEP-01": {
        id: "KEEP-01",
        status: "貸出中",
        location: "現場A",
      },
      "KEEP-02": {
        id: "KEEP-02",
        status: "貸出中",
        location: "",
      },
    } satisfies TankMap;

    await submitManualTankOperation({
      mode: "return",
      items: [
        { tankId: "KEEP-01", status: "lent", tag: "keep" },
        { tankId: "KEEP-02", status: "lent", tag: "keep" },
        { tankId: "KEEP-03", status: "lent", tag: "keep" },
      ],
      customer: null,
      tanks,
    });

    expect(requireStaffIdentityMock).toHaveBeenCalledTimes(1);
    expect(applyBulkTankOperationsMock).toHaveBeenCalledTimes(1);
    expect(applyBulkTankOperationsMock.mock.calls[0]).toEqual([
      [
        {
          tankId: "KEEP-01",
          transitionAction: "carry_over",
          currentStatus: "lent",
          context: {
            actor: ACTOR,
            source: "manual",
            workflow: "tank_operation",
            returnCondition: "keep",
          },
          location: "現場A",
          tankNote: "",
          logNote: "持ち越し",
        },
        {
          tankId: "KEEP-02",
          transitionAction: "carry_over",
          currentStatus: "lent",
          context: {
            actor: ACTOR,
            source: "manual",
            workflow: "tank_operation",
            returnCondition: "keep",
          },
          location: "不明",
          tankNote: "",
          logNote: "持ち越し",
        },
        {
          tankId: "KEEP-03",
          transitionAction: "carry_over",
          currentStatus: "lent",
          context: {
            actor: ACTOR,
            source: "manual",
            workflow: "tank_operation",
            returnCondition: "keep",
          },
          location: "不明",
          tankNote: "",
          logNote: "持ち越し",
        },
      ],
    ]);

    expectPayloadShape(
      applyBulkTankOperationsMock.mock.calls[0][0],
      ["actor", "source", "workflow", "returnCondition"],
    );
  });

  it("不正statusが含まれる場合は厳密なmessageでrejectしbulk writeを開始しない", async () => {
    await expect(submitManualTankOperation({
      mode: "fill",
      items: [
        { tankId: "VALID-01", status: "empty", tag: "normal" },
        { tankId: "BAD-02", status: "invalid-status", tag: "normal" },
      ],
      customer: null,
      tanks: {},
    })).rejects.toMatchObject({
      message: "[BAD-02] タンク状態が不正です",
    });

    expect(requireStaffIdentityMock).toHaveBeenCalledTimes(1);
    expect(applyBulkTankOperationsMock).toHaveBeenCalledTimes(0);
  });

  it("bulk operationの例外を独自変換せず同じinstanceで透過する", async () => {
    const failure = new Error("bulk failure");
    applyBulkTankOperationsMock.mockRejectedValueOnce(failure);

    await expect(submitManualTankOperation({
      mode: "fill",
      items: [
        { tankId: "I-09", status: "empty", tag: "normal" },
      ],
      customer: null,
      tanks: {},
    })).rejects.toBe(failure);

    expect(requireStaffIdentityMock).toHaveBeenCalledTimes(1);
    expect(applyBulkTankOperationsMock).toHaveBeenCalledTimes(1);
    expect(applyBulkTankOperationsMock.mock.calls[0]).toEqual([
      [
        {
          tankId: "I-09",
          transitionAction: "fill",
          currentStatus: "empty",
          context: {
            actor: ACTOR,
            source: "manual",
            workflow: "tank_operation",
          },
          location: "倉庫",
          tankNote: "",
          logNote: "",
        },
      ],
    ]);

    expectPayloadShape(
      applyBulkTankOperationsMock.mock.calls[0][0],
      ["actor", "source", "workflow"],
    );
  });
});
