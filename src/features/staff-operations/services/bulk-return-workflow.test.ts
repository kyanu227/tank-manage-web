import { beforeEach, describe, expect, it, vi } from "vitest";
import { updateTankReturnTagMarker } from "@/lib/firebase/tank-tag-service";
import type { OperationActor } from "@/lib/operation-context";
import { applyBulkTankOperations } from "@/lib/tank-operation";
import type { ReturnTag } from "@/lib/tank-rules";
import {
  submitBulkReturnGroup,
  updateBulkReturnTagMarker,
} from "@/features/staff-operations/services/bulk-return-workflow";

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

describe("bulk-return-workflow", () => {
  beforeEach(() => {
    applyBulkTankOperationsMock.mockReset();
    applyBulkTankOperationsMock.mockResolvedValue([]);
    updateTankReturnTagMarkerMock.mockReset();
    updateTankReturnTagMarkerMock.mockResolvedValue(undefined);
  });

  it("全tag・status・falsy fallbackを入力順のexact payloadで1回だけ処理する", async () => {
    await submitBulkReturnGroup({
      tanks: [
        {
          id: "L-NORMAL",
          status: "lent",
          location: "貸出先A",
          tag: "normal",
        },
        {
          id: "L-UNUSED",
          status: "貸出中",
          location: "貸出先A",
          tag: "unused",
        },
        {
          id: "L-UNCHARGED",
          status: "lent",
          location: "貸出先A",
          tag: "uncharged",
        },
        {
          id: "L-KEEP",
          status: "貸出中",
          location: "タンク自身の貸出先",
          tag: "keep",
        },
        {
          id: "U-NORMAL",
          status: "未返却",
          location: "貸出先B",
          tag: "normal",
        },
        {
          id: "U-UNUSED",
          status: "unreturned",
          location: "貸出先B",
          tag: "unused",
        },
        {
          id: "U-UNCHARGED",
          status: "未返却",
          location: "貸出先B",
          tag: "uncharged",
        },
        {
          id: "U-KEEP",
          status: "unreturned",
          location: "未返却先",
          tag: "keep",
        },
        {
          id: "FALSY-NORMAL",
          status: "filled",
          location: "貸出先C",
          tag: "" as ReturnTag,
        },
      ],
      fallbackLocation: "グループ貸出先",
      actor: ACTOR,
    });

    expect(applyBulkTankOperationsMock).toHaveBeenCalledTimes(1);
    expect(applyBulkTankOperationsMock.mock.calls[0]).toEqual([
      [
        {
          tankId: "L-NORMAL",
          transitionAction: "return",
          currentStatus: "lent",
          context: {
            actor: ACTOR,
            source: "bulk_return",
            workflow: "tank_operation",
          },
          location: "倉庫",
          tankNote: "",
          logNote: "",
        },
        {
          tankId: "L-UNUSED",
          transitionAction: "return_unused",
          currentStatus: "貸出中",
          context: {
            actor: ACTOR,
            source: "bulk_return",
            workflow: "tank_operation",
          },
          location: "倉庫",
          tankNote: "",
          logNote: "",
        },
        {
          tankId: "L-UNCHARGED",
          transitionAction: "return_uncharged",
          currentStatus: "lent",
          context: {
            actor: ACTOR,
            source: "bulk_return",
            workflow: "tank_operation",
          },
          location: "倉庫",
          tankNote: "",
          logNote: "",
        },
        {
          tankId: "L-KEEP",
          transitionAction: "carry_over",
          currentStatus: "貸出中",
          context: {
            actor: ACTOR,
            source: "bulk_return",
            workflow: "tank_operation",
          },
          location: "タンク自身の貸出先",
          tankNote: "",
          logNote: "持ち越し",
        },
        {
          tankId: "U-NORMAL",
          transitionAction: "return",
          currentStatus: "未返却",
          context: {
            actor: ACTOR,
            source: "bulk_return",
            workflow: "tank_operation",
          },
          location: "倉庫",
          tankNote: "",
          logNote: "",
        },
        {
          tankId: "U-UNUSED",
          transitionAction: "return_unused",
          currentStatus: "unreturned",
          context: {
            actor: ACTOR,
            source: "bulk_return",
            workflow: "tank_operation",
          },
          location: "倉庫",
          tankNote: "",
          logNote: "",
        },
        {
          tankId: "U-UNCHARGED",
          transitionAction: "return_uncharged",
          currentStatus: "未返却",
          context: {
            actor: ACTOR,
            source: "bulk_return",
            workflow: "tank_operation",
          },
          location: "倉庫",
          tankNote: "",
          logNote: "",
        },
        {
          tankId: "U-KEEP",
          transitionAction: "carry_over",
          currentStatus: "unreturned",
          context: {
            actor: ACTOR,
            source: "bulk_return",
            workflow: "tank_operation",
          },
          location: "未返却先",
          tankNote: "",
          logNote: "持ち越し",
        },
        {
          tankId: "FALSY-NORMAL",
          transitionAction: "return",
          currentStatus: "filled",
          context: {
            actor: ACTOR,
            source: "bulk_return",
            workflow: "tank_operation",
          },
          location: "倉庫",
          tankNote: "",
          logNote: "",
        },
      ],
    ]);

    const operations = applyBulkTankOperationsMock.mock.calls[0][0];
    expect(operations.map((operation) => Object.keys(operation).sort())).toEqual(
      operations.map(() => [
        "context",
        "currentStatus",
        "location",
        "logNote",
        "tankId",
        "tankNote",
        "transitionAction",
      ]),
    );
    expect(operations.map((operation) => Object.keys(operation.context).sort())).toEqual(
      operations.map(() => ["actor", "source", "workflow"]),
    );
    expect(
      operations.slice(1).every(
        (operation) => operation.context === operations[0].context,
      ),
    ).toBe(true);
    operations.forEach((operation) => {
      [
        "customer",
        "transactionId",
        "returnCondition",
        "provenance",
        "logAction",
        "tankExtra",
        "logExtra",
        "skipValidation",
        "tag",
        "marker",
      ].forEach((key) => {
        expect(operation).not.toHaveProperty(key);
      });
      [
        "customer",
        "transactionId",
        "returnCondition",
        "provenance",
        "returnTag",
        "groupKey",
        "groupLocation",
        "pool",
        "poolLabel",
        "dateLabel",
      ].forEach((key) => {
        expect(operation.context).not.toHaveProperty(key);
      });
    });
    expect(updateTankReturnTagMarkerMock).toHaveBeenCalledTimes(0);
  });

  it("KEEP locationはtank自身・fallback・不明の順でfalsy fallbackする", async () => {
    await submitBulkReturnGroup({
      tanks: [
        {
          id: "KEEP-TANK",
          status: "lent",
          location: "タンク自身の貸出先",
          tag: "keep",
        },
      ],
      fallbackLocation: "グループ貸出先",
      actor: ACTOR,
    });
    await submitBulkReturnGroup({
      tanks: [
        {
          id: "KEEP-GROUP",
          status: "lent",
          location: "",
          tag: "keep",
        },
      ],
      fallbackLocation: "グループ貸出先",
      actor: ACTOR,
    });
    await submitBulkReturnGroup({
      tanks: [
        {
          id: "KEEP-UNKNOWN",
          status: "lent",
          location: "",
          tag: "keep",
        },
      ],
      fallbackLocation: "",
      actor: ACTOR,
    });

    expect(applyBulkTankOperationsMock).toHaveBeenCalledTimes(3);
    expect(applyBulkTankOperationsMock.mock.calls).toEqual([
      [
        [
          {
            tankId: "KEEP-TANK",
            transitionAction: "carry_over",
            currentStatus: "lent",
            context: {
              actor: ACTOR,
              source: "bulk_return",
              workflow: "tank_operation",
            },
            location: "タンク自身の貸出先",
            tankNote: "",
            logNote: "持ち越し",
          },
        ],
      ],
      [
        [
          {
            tankId: "KEEP-GROUP",
            transitionAction: "carry_over",
            currentStatus: "lent",
            context: {
              actor: ACTOR,
              source: "bulk_return",
              workflow: "tank_operation",
            },
            location: "グループ貸出先",
            tankNote: "",
            logNote: "持ち越し",
          },
        ],
      ],
      [
        [
          {
            tankId: "KEEP-UNKNOWN",
            transitionAction: "carry_over",
            currentStatus: "lent",
            context: {
              actor: ACTOR,
              source: "bulk_return",
              workflow: "tank_operation",
            },
            location: "不明",
            tankNote: "",
            logNote: "持ち越し",
          },
        ],
      ],
    ]);
    expect(updateTankReturnTagMarkerMock).toHaveBeenCalledTimes(0);
  });

  it("不正statusはexact errorでbulk・marker write前に停止する", async () => {
    await expect(submitBulkReturnGroup({
      tanks: [
        {
          id: "VALID-01",
          status: "lent",
          location: "貸出先A",
          tag: "normal",
        },
        {
          id: "BAD-01",
          status: "invalid",
          location: "貸出先A",
          tag: "normal",
        },
      ],
      fallbackLocation: "貸出先A",
      actor: ACTOR,
    })).rejects.toThrowError(/^\[BAD-01\] status が不正です$/);

    expect(applyBulkTankOperationsMock).toHaveBeenCalledTimes(0);
    expect(updateTankReturnTagMarkerMock).toHaveBeenCalledTimes(0);
  });

  it("空配列も独自guardを足さずbulk operationへ素通しする", async () => {
    await submitBulkReturnGroup({
      tanks: [],
      fallbackLocation: "貸出先A",
      actor: ACTOR,
    });

    expect(applyBulkTankOperationsMock).toHaveBeenCalledTimes(1);
    expect(applyBulkTankOperationsMock.mock.calls[0]).toEqual([[]]);
    expect(updateTankReturnTagMarkerMock).toHaveBeenCalledTimes(0);
  });

  it("bulk operationのrejectを同じError instanceで透過する", async () => {
    const failure = new Error("bulk failed");
    applyBulkTankOperationsMock.mockRejectedValueOnce(failure);

    await expect(submitBulkReturnGroup({
      tanks: [
        {
          id: "FAIL-01",
          status: "lent",
          location: "貸出先A",
          tag: "normal",
        },
      ],
      fallbackLocation: "貸出先A",
      actor: ACTOR,
    })).rejects.toBe(failure);

    expect(applyBulkTankOperationsMock).toHaveBeenCalledTimes(1);
    expect(updateTankReturnTagMarkerMock).toHaveBeenCalledTimes(0);
  });

  it("全tagを変換せずmarker ownerへ各1回委譲する", async () => {
    await updateBulkReturnTagMarker("MARKER-NORMAL", "normal");
    await updateBulkReturnTagMarker("MARKER-UNUSED", "unused");
    await updateBulkReturnTagMarker("MARKER-UNCHARGED", "uncharged");
    await updateBulkReturnTagMarker("MARKER-KEEP", "keep");

    expect(updateTankReturnTagMarkerMock).toHaveBeenCalledTimes(4);
    expect(updateTankReturnTagMarkerMock.mock.calls).toEqual([
      ["MARKER-NORMAL", "normal"],
      ["MARKER-UNUSED", "unused"],
      ["MARKER-UNCHARGED", "uncharged"],
      ["MARKER-KEEP", "keep"],
    ]);
    expect(applyBulkTankOperationsMock).toHaveBeenCalledTimes(0);
  });

  it("marker ownerのrejectを同じError instanceで透過する", async () => {
    const failure = new Error("marker failed");
    updateTankReturnTagMarkerMock.mockRejectedValueOnce(failure);

    await expect(
      updateBulkReturnTagMarker("MARKER-FAIL", "unused"),
    ).rejects.toBe(failure);

    expect(updateTankReturnTagMarkerMock).toHaveBeenCalledTimes(1);
    expect(applyBulkTankOperationsMock).toHaveBeenCalledTimes(0);
  });
});
