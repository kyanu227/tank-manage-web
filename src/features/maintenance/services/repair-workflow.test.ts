import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OperationActor } from "@/lib/operation-context";
import { applyBulkTankOperations } from "@/lib/tank-operation";
import { submitRepairCompletion } from "@/features/maintenance/services/repair-workflow";

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

const applyBulkTankOperationsMock = vi.mocked(applyBulkTankOperations);

describe("submitRepairCompletion", () => {
  beforeEach(() => {
    applyBulkTankOperationsMock.mockReset();
    applyBulkTankOperationsMock.mockResolvedValue([]);
  });

  it("異なるcurrentStatusの複数タンクを入力順のpayloadで一括送信する", async () => {
    await submitRepairCompletion({
      tanks: [
        { tankId: "A01", currentStatus: "damaged" },
        { tankId: "B02", currentStatus: "defective" },
      ],
      actor: ACTOR,
    });

    expect(applyBulkTankOperationsMock).toHaveBeenCalledTimes(1);
    expect(applyBulkTankOperationsMock.mock.calls[0]).toEqual([
      [
        {
          tankId: "A01",
          transitionAction: "修理済み",
          currentStatus: "damaged",
          context: { actor: ACTOR },
          location: "倉庫",
        },
        {
          tankId: "B02",
          transitionAction: "修理済み",
          currentStatus: "defective",
          context: { actor: ACTOR },
          location: "倉庫",
        },
      ],
    ]);
  });

  it("単一タンクもnoteなしの従来どおりのpayloadで一括送信する", async () => {
    await submitRepairCompletion({
      tanks: [{ tankId: "C03", currentStatus: "damaged" }],
      actor: ACTOR,
    });

    expect(applyBulkTankOperationsMock).toHaveBeenCalledTimes(1);
    expect(applyBulkTankOperationsMock.mock.calls[0]).toEqual([
      [
        {
          tankId: "C03",
          transitionAction: "修理済み",
          currentStatus: "damaged",
          context: { actor: ACTOR },
          location: "倉庫",
        },
      ],
    ]);
  });
});
