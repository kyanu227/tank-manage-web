import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OperationActor } from "@/lib/operation-context";
import { applyBulkTankOperations } from "@/lib/tank-operation";
import { updateTankReturnTagMarker } from "@/lib/firebase/tank-tag-service";
import type { ReturnTag } from "@/lib/tank-rules";
import {
  submitInHouseBulkReturn,
  updateInHouseReturnTagMarker,
} from "@/features/inhouse/services/inhouse-return-workflow";

vi.mock("@/lib/tank-operation", () => ({
  applyBulkTankOperations: vi.fn(),
}));

vi.mock("@/lib/firebase/tank-tag-service", () => ({
  updateTankReturnTagMarker: vi.fn(),
}));

const ACTOR = {
  staffId: "staff-001",
  staffName: "山田 太郎",
  staffEmail: "yamada@example.com",
  role: "worker",
  rank: "A",
} satisfies OperationActor;

const applyBulkTankOperationsMock = vi.mocked(applyBulkTankOperations);
const updateTankReturnTagMarkerMock = vi.mocked(updateTankReturnTagMarker);

describe("inhouse-return-workflow", () => {
  beforeEach(() => {
    applyBulkTankOperationsMock.mockReset();
    applyBulkTankOperationsMock.mockResolvedValue([]);
    updateTankReturnTagMarkerMock.mockReset();
    updateTankReturnTagMarkerMock.mockResolvedValue(undefined);
  });

  it("tag別の複数タンクを入力順のpayloadで1回だけ一括返却する", async () => {
    await submitInHouseBulkReturn({
      tanks: [
        { tankId: "A01", tag: "normal" },
        { tankId: "B02", tag: "unused" },
        { tankId: "C03", tag: "uncharged" },
      ],
      actor: ACTOR,
    });

    expect(applyBulkTankOperationsMock).toHaveBeenCalledTimes(1);
    expect(applyBulkTankOperationsMock.mock.calls[0]).toEqual([
      [
        {
          tankId: "A01",
          transitionAction: "inhouse_return",
          currentStatus: "in_house",
          context: {
            actor: ACTOR,
            source: "manual",
            workflow: "tank_operation",
          },
          location: "倉庫",
        },
        {
          tankId: "B02",
          transitionAction: "inhouse_return_unused",
          currentStatus: "in_house",
          context: {
            actor: ACTOR,
            source: "manual",
            workflow: "tank_operation",
          },
          location: "倉庫",
        },
        {
          tankId: "C03",
          transitionAction: "inhouse_return_uncharged",
          currentStatus: "in_house",
          context: {
            actor: ACTOR,
            source: "manual",
            workflow: "tank_operation",
          },
          location: "倉庫",
        },
      ],
    ]);

    const operations = applyBulkTankOperationsMock.mock.calls[0][0];
    expect(operations.map((operation) => Object.keys(operation).sort())).toEqual([
      ["context", "currentStatus", "location", "tankId", "transitionAction"],
      ["context", "currentStatus", "location", "tankId", "transitionAction"],
      ["context", "currentStatus", "location", "tankId", "transitionAction"],
    ]);
    expect(operations.map((operation) => Object.keys(operation.context))).toEqual([
      ["actor", "source", "workflow"],
      ["actor", "source", "workflow"],
      ["actor", "source", "workflow"],
    ]);
    expect(operations.some((operation) => (
      "logNote" in operation
      || "tankNote" in operation
      || "tankExtra" in operation
      || "logExtra" in operation
      || "logAction" in operation
      || "provenance" in operation
      || "customer" in operation.context
      || "transactionId" in operation.context
      || "returnCondition" in operation.context
      || "provenance" in operation.context
    ))).toBe(false);
    expect(updateTankReturnTagMarkerMock).toHaveBeenCalledTimes(0);
  });

  it("falsyなtagをnormalとして一括返却する", async () => {
    await submitInHouseBulkReturn({
      tanks: [{ tankId: "D04", tag: "" as ReturnTag }],
      actor: ACTOR,
    });

    expect(applyBulkTankOperationsMock).toHaveBeenCalledTimes(1);
    expect(applyBulkTankOperationsMock.mock.calls[0]).toEqual([
      [
        {
          tankId: "D04",
          transitionAction: "inhouse_return",
          currentStatus: "in_house",
          context: {
            actor: ACTOR,
            source: "manual",
            workflow: "tank_operation",
          },
          location: "倉庫",
        },
      ],
    ]);
    expect(updateTankReturnTagMarkerMock).toHaveBeenCalledTimes(0);
  });

  it("空配列も独自guardを足さずbulk operationへ素通しする", async () => {
    await submitInHouseBulkReturn({
      tanks: [],
      actor: ACTOR,
    });

    expect(applyBulkTankOperationsMock).toHaveBeenCalledTimes(1);
    expect(applyBulkTankOperationsMock.mock.calls[0]).toEqual([[]]);
    expect(updateTankReturnTagMarkerMock).toHaveBeenCalledTimes(0);
  });

  it("返却タグmarkerをtankIdとtagの順で1回だけ書き込む", async () => {
    await updateInHouseReturnTagMarker("E05", "unused");

    expect(updateTankReturnTagMarkerMock).toHaveBeenCalledTimes(1);
    expect(updateTankReturnTagMarkerMock.mock.calls[0]).toEqual([
      "E05",
      "unused",
    ]);
    expect(applyBulkTankOperationsMock).toHaveBeenCalledTimes(0);
  });
});
