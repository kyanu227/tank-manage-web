import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OperationActor } from "@/lib/operation-context";
import { applyBulkTankOperations } from "@/lib/tank-operation";
import { submitInspectionCompletion } from "@/features/maintenance/services/inspection-workflow";

vi.mock("@/lib/tank-operation", () => ({
  applyBulkTankOperations: vi.fn(),
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

describe("submitInspectionCompletion", () => {
  beforeEach(() => {
    applyBulkTankOperationsMock.mockReset();
    applyBulkTankOperationsMock.mockResolvedValue([]);
  });

  it("異なるcurrentStatusの複数タンクをinspection provenance付きで一括送信する", async () => {
    await submitInspectionCompletion({
      tanks: [
        { tankId: "A01", currentStatus: "filled" },
        { tankId: "B02", currentStatus: "lent" },
      ],
      validityYears: 5,
      nextInspectionDateBase: new Date(2026, 6, 25, 14, 30),
      inspectionDate: new Date(2026, 6, 25, 14, 30),
      actor: ACTOR,
    });

    expect(applyBulkTankOperationsMock).toHaveBeenCalledTimes(1);
    expect(applyBulkTankOperationsMock.mock.calls[0]).toEqual([
      [
        {
          tankId: "A01",
          transitionAction: "耐圧検査完了",
          currentStatus: "filled",
          context: {
            actor: ACTOR,
            source: "maintenance",
            workflow: "inspection",
          },
          location: "倉庫",
          tankExtra: {
            maintenanceDate: "2026/07/25",
            nextMaintenanceDate: "2031/07/25",
          },
        },
        {
          tankId: "B02",
          transitionAction: "耐圧検査完了",
          currentStatus: "lent",
          context: {
            actor: ACTOR,
            source: "maintenance",
            workflow: "inspection",
          },
          location: "倉庫",
          tankExtra: {
            maintenanceDate: "2026/07/25",
            nextMaintenanceDate: "2031/07/25",
          },
        },
      ],
      undefined,
      UNDEFINED_RECOVERY_OPTIONS,
    ]);

    const operations = applyBulkTankOperationsMock.mock.calls[0][0];
    expect(operations.map((operation) => Object.keys(operation).sort())).toEqual([
      ["context", "currentStatus", "location", "tankExtra", "tankId", "transitionAction"],
      ["context", "currentStatus", "location", "tankExtra", "tankId", "transitionAction"],
    ]);
    expect(operations.map((operation) => Object.keys(operation.context))).toEqual([
      ["actor", "source", "workflow"],
      ["actor", "source", "workflow"],
    ]);
    expect(operations.every((operation) => operation.context.actor === ACTOR)).toBe(true);
    expect(operations.some((operation) => (
      "logNote" in operation
      || "tankNote" in operation
      || "returnCondition" in operation.context
      || "provenance" in operation
      || "provenance" in operation.context
    ))).toBe(false);
  });

  it("単一タンクも異なる期限設定から同じpayload構造で一括送信する", async () => {
    await submitInspectionCompletion({
      tanks: [{ tankId: "C03", currentStatus: "damaged" }],
      validityYears: 3,
      nextInspectionDateBase: new Date(2026, 6, 25, 14, 30),
      inspectionDate: new Date(2026, 6, 25, 14, 30),
      actor: ACTOR,
    });

    expect(applyBulkTankOperationsMock).toHaveBeenCalledTimes(1);
    expect(applyBulkTankOperationsMock.mock.calls[0]).toEqual([
      [
        {
          tankId: "C03",
          transitionAction: "耐圧検査完了",
          currentStatus: "damaged",
          context: {
            actor: ACTOR,
            source: "maintenance",
            workflow: "inspection",
          },
          location: "倉庫",
          tankExtra: {
            maintenanceDate: "2026/07/25",
            nextMaintenanceDate: "2029/07/25",
          },
        },
      ],
      undefined,
      UNDEFINED_RECOVERY_OPTIONS,
    ]);

    const [operation] = applyBulkTankOperationsMock.mock.calls[0][0];
    expect(Object.keys(operation).sort()).toEqual([
      "context",
      "currentStatus",
      "location",
      "tankExtra",
      "tankId",
      "transitionAction",
    ]);
    expect(Object.keys(operation.context)).toEqual(["actor", "source", "workflow"]);
    expect(
      "logNote" in operation
      || "tankNote" in operation
      || "returnCondition" in operation.context
      || "provenance" in operation
      || "provenance" in operation.context,
    ).toBe(false);
  });
});
