import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OperationActor } from "@/lib/operation-context";
import { applyBulkTankOperations } from "@/lib/tank-operation";
import { submitDamageReport } from "@/features/maintenance/services/damage-workflow";

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

describe("submitDamageReport", () => {
  beforeEach(() => {
    applyBulkTankOperationsMock.mockReset();
    applyBulkTankOperationsMock.mockResolvedValue([]);
  });

  it("複数タンクと入力済みnoteを従来どおりのpayloadで一括送信する", async () => {
    await submitDamageReport({
      tankIds: ["A01", "B02"],
      note: "バルブ不良、タンク凹み",
      actor: ACTOR,
    });

    expect(applyBulkTankOperationsMock).toHaveBeenCalledTimes(1);
    expect(applyBulkTankOperationsMock.mock.calls[0]).toEqual([
      [
        {
          tankId: "A01",
          transitionAction: "破損報告",
          context: { actor: ACTOR },
          location: "倉庫",
          logNote: "バルブ不良、タンク凹み",
        },
        {
          tankId: "B02",
          transitionAction: "破損報告",
          context: { actor: ACTOR },
          location: "倉庫",
          logNote: "バルブ不良、タンク凹み",
        },
      ],
    ]);
  });

  it("空のnoteも省略せず従来どおり空文字で送信する", async () => {
    await submitDamageReport({
      tankIds: ["C03"],
      note: "",
      actor: ACTOR,
    });

    expect(applyBulkTankOperationsMock).toHaveBeenCalledTimes(1);
    expect(applyBulkTankOperationsMock.mock.calls[0]).toEqual([
      [
        {
          tankId: "C03",
          transitionAction: "破損報告",
          context: { actor: ACTOR },
          location: "倉庫",
          logNote: "",
        },
      ],
    ]);
  });
});
