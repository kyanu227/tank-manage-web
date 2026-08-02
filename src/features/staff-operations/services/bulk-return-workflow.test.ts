import { beforeEach, describe, expect, it, vi } from "vitest";
import { updateTankReturnTagMarker } from "@/lib/firebase/tank-tag-service";
import type { OperationActor } from "@/lib/operation-context";
import {
  applyBulkTankOperations,
  StaleTankCycleError,
} from "@/lib/tank-operation";
import type { ReturnTag } from "@/lib/tank-rules";
import {
  submitBulkReturnGroup,
  type BulkReturnTargetInput,
  updateBulkReturnTagMarker,
} from "@/features/staff-operations/services/bulk-return-workflow";

vi.mock("@/lib/tank-operation", () => ({
  applyBulkTankOperations: vi.fn(),
  StaleTankCycleError: class StaleTankCycleError extends Error {
    readonly name = "StaleTankCycleError";
    readonly code = "stale_tank_cycle";
    readonly issues: readonly unknown[];

    constructor(issues: readonly unknown[]) {
      super("stale tank cycle");
      this.issues = issues;
    }
  },
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

const UNDEFINED_RECOVERY_OPTIONS = {
  recoveryConfirmationResolver: undefined,
};

const applyBulkTankOperationsMock = vi.mocked(applyBulkTankOperations);
const updateTankReturnTagMarkerMock = vi.mocked(updateTankReturnTagMarker);
const EXPECTED_CYCLE = {
  customerId: "customer-001",
  latestLogId: "log-001",
} as const;

function withExpectedCycle(
  tank: Omit<BulkReturnTargetInput, "customerId" | "latestLogId">,
): BulkReturnTargetInput {
  return { ...tank, ...EXPECTED_CYCLE };
}

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
        withExpectedCycle({
          id: "L-NORMAL",
          status: "lent",
          location: "貸出先A",
          tag: "normal",
        }),
        withExpectedCycle({
          id: "L-UNUSED",
          status: "貸出中",
          location: "貸出先A",
          tag: "unused",
        }),
        withExpectedCycle({
          id: "L-UNCHARGED",
          status: "lent",
          location: "貸出先A",
          tag: "uncharged",
        }),
        withExpectedCycle({
          id: "L-KEEP",
          status: "貸出中",
          location: "タンク自身の貸出先",
          tag: "keep",
        }),
        withExpectedCycle({
          id: "U-NORMAL",
          status: "未返却",
          location: "貸出先B",
          tag: "normal",
        }),
        withExpectedCycle({
          id: "U-UNUSED",
          status: "unreturned",
          location: "貸出先B",
          tag: "unused",
        }),
        withExpectedCycle({
          id: "U-UNCHARGED",
          status: "未返却",
          location: "貸出先B",
          tag: "uncharged",
        }),
        withExpectedCycle({
          id: "U-KEEP",
          status: "unreturned",
          location: "未返却先",
          tag: "keep",
        }),
        withExpectedCycle({
          id: "FALSY-NORMAL",
          status: "filled",
          location: "貸出先C",
          tag: "" as ReturnTag,
        }),
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
          expectedCycle: EXPECTED_CYCLE,
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
          expectedCycle: EXPECTED_CYCLE,
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
          expectedCycle: EXPECTED_CYCLE,
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
          expectedCycle: EXPECTED_CYCLE,
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
          expectedCycle: EXPECTED_CYCLE,
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
          expectedCycle: EXPECTED_CYCLE,
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
          expectedCycle: EXPECTED_CYCLE,
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
          expectedCycle: EXPECTED_CYCLE,
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
          expectedCycle: EXPECTED_CYCLE,
        },
      ],
      undefined,
      UNDEFINED_RECOVERY_OPTIONS,
    ]);

    const operations = applyBulkTankOperationsMock.mock.calls[0][0];
    expect(operations.map((operation) => Object.keys(operation).sort())).toEqual(
      operations.map(() => [
        "context",
        "currentStatus",
        "expectedCycle",
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
        withExpectedCycle({
          id: "KEEP-TANK",
          status: "lent",
          location: "タンク自身の貸出先",
          tag: "keep",
        }),
      ],
      fallbackLocation: "グループ貸出先",
      actor: ACTOR,
    });
    await submitBulkReturnGroup({
      tanks: [
        withExpectedCycle({
          id: "KEEP-GROUP",
          status: "lent",
          location: "",
          tag: "keep",
        }),
      ],
      fallbackLocation: "グループ貸出先",
      actor: ACTOR,
    });
    await submitBulkReturnGroup({
      tanks: [
        withExpectedCycle({
          id: "KEEP-UNKNOWN",
          status: "lent",
          location: "",
          tag: "keep",
        }),
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
            expectedCycle: EXPECTED_CYCLE,
          },
        ],
        undefined,
        UNDEFINED_RECOVERY_OPTIONS,
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
            expectedCycle: EXPECTED_CYCLE,
          },
        ],
        undefined,
        UNDEFINED_RECOVERY_OPTIONS,
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
            expectedCycle: EXPECTED_CYCLE,
          },
        ],
        undefined,
        UNDEFINED_RECOVERY_OPTIONS,
      ],
    ]);
    expect(updateTankReturnTagMarkerMock).toHaveBeenCalledTimes(0);
  });

  it("不正statusはexact errorでbulk・marker write前に停止する", async () => {
    await expect(submitBulkReturnGroup({
      tanks: [
        withExpectedCycle({
          id: "VALID-01",
          status: "lent",
          location: "貸出先A",
          tag: "normal",
        }),
        withExpectedCycle({
          id: "BAD-01",
          status: "invalid",
          location: "貸出先A",
          tag: "normal",
        }),
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
    expect(applyBulkTankOperationsMock.mock.calls[0]).toEqual([
      [],
      undefined,
      UNDEFINED_RECOVERY_OPTIONS,
    ]);
    expect(updateTankReturnTagMarkerMock).toHaveBeenCalledTimes(0);
  });

  it("bulk operationのrejectを同じError instanceで透過する", async () => {
    const failure = new Error("bulk failed");
    applyBulkTankOperationsMock.mockRejectedValueOnce(failure);

    await expect(submitBulkReturnGroup({
      tanks: [
        withExpectedCycle({
          id: "FAIL-01",
          status: "lent",
          location: "貸出先A",
          tag: "normal",
        }),
      ],
      fallbackLocation: "貸出先A",
      actor: ACTOR,
    })).rejects.toBe(failure);

    expect(applyBulkTankOperationsMock).toHaveBeenCalledTimes(1);
    expect(updateTankReturnTagMarkerMock).toHaveBeenCalledTimes(0);
  });

  it("#15 marker欠落をstructured errorにしてdomain writerを呼ばない", async () => {
    const error = await submitBulkReturnGroup({
      tanks: [
        {
          id: "MISSING-01",
          status: "lent",
          customerId: "customer-001",
          latestLogId: null,
          location: "貸出先A",
          tag: "normal",
        },
      ],
      fallbackLocation: "貸出先A",
      actor: ACTOR,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(StaleTankCycleError);
    expect(error).toMatchObject({
      name: "StaleTankCycleError",
      code: "stale_tank_cycle",
      issues: [
        {
          tankId: "MISSING-01",
          field: "latestLogId",
          reason: "missing_expected",
        },
      ],
    });
    expect(applyBulkTankOperationsMock).toHaveBeenCalledTimes(0);
  });

  it("#16 複数候補の1件にmarker欠落があれば部分継続しない", async () => {
    const error = await submitBulkReturnGroup({
      tanks: [
        withExpectedCycle({
          id: "VALID-FIRST",
          status: "lent",
          location: "貸出先A",
          tag: "normal",
        }),
        {
          id: "MISSING-SECOND",
          status: "lent",
          customerId: "",
          latestLogId: "log-002",
          location: "貸出先A",
          tag: "normal",
        },
      ],
      fallbackLocation: "貸出先A",
      actor: ACTOR,
    }).catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      code: "stale_tank_cycle",
      issues: [
        {
          tankId: "MISSING-SECOND",
          field: "customerId",
          reason: "missing_expected",
        },
      ],
    });
    expect(applyBulkTankOperationsMock).toHaveBeenCalledTimes(0);
  });

  it("#17/#18 全valid候補の観測値を加工せず各expectedCycleへ渡す", async () => {
    await submitBulkReturnGroup({
      tanks: [
        {
          id: "EXACT-01",
          status: "lent",
          customerId: " customer-01 ",
          latestLogId: "log-01",
          location: "貸出先A",
          tag: "normal",
        },
        {
          id: "EXACT-02",
          status: "unreturned",
          customerId: "customer-02",
          latestLogId: " log-02 ",
          location: "貸出先A",
          tag: "unused",
        },
      ],
      fallbackLocation: "貸出先A",
      actor: ACTOR,
    });

    expect(applyBulkTankOperationsMock).toHaveBeenCalledTimes(1);
    expect(
      applyBulkTankOperationsMock.mock.calls[0][0].map(
        ({ tankId, expectedCycle }) => ({ tankId, expectedCycle }),
      ),
    ).toEqual([
      {
        tankId: "EXACT-01",
        expectedCycle: {
          customerId: " customer-01 ",
          latestLogId: "log-01",
        },
      },
      {
        tankId: "EXACT-02",
        expectedCycle: {
          customerId: "customer-02",
          latestLogId: " log-02 ",
        },
      },
    ]);
  });

  it("repository raw cycle marker を正規化済み表示値より優先して expectedCycle へ渡す", async () => {
    await submitBulkReturnGroup({
      tanks: [
        {
          id: "RAW-EXPECTED-01",
          status: "lent",
          customerId: "normalized-customer",
          latestLogId: "normalized-log",
          rawCycleMarkers: {
            customerId: " raw-customer ",
            latestLogId: " raw-log ",
          },
          location: "貸出先A",
          tag: "normal",
        },
      ],
      fallbackLocation: "貸出先A",
      actor: ACTOR,
    });

    expect(applyBulkTankOperationsMock.mock.calls[0][0][0]).toMatchObject({
      tankId: "RAW-EXPECTED-01",
      expectedCycle: {
        customerId: " raw-customer ",
        latestLogId: " raw-log ",
      },
    });
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
