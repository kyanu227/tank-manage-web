import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CustomerSnapshot,
  OperationActor,
} from "@/lib/operation-context";
import {
  applyLogCorrection,
  voidLog,
} from "@/lib/tank-operation";
import {
  correctDashboardLogLocations,
  correctDashboardLogTankId,
  voidDashboardLog,
  voidDashboardLogs,
} from "@/features/staff-dashboard/services/log-correction-workflow";

vi.mock("@/lib/tank-operation", () => ({
  applyLogCorrection: vi.fn(),
  voidLog: vi.fn(),
}));

const ACTOR_A = {
  staffId: "staff-a",
  staffName: "担当者A",
  staffEmail: "staff-a@example.com",
  role: "worker",
  rank: "A",
} satisfies OperationActor;

const ACTOR_B = {
  staffId: "staff-b",
  staffName: "担当者B",
  staffEmail: "staff-b@example.com",
  role: "worker",
  rank: "B",
} satisfies OperationActor;

const ACTOR_C = {
  staffId: "staff-c",
  staffName: "担当者C",
  staffEmail: "staff-c@example.com",
  role: "admin",
  rank: "C",
} satisfies OperationActor;

const CUSTOMER = {
  customerId: "customer-001",
  customerName: "検証貸出先",
} satisfies CustomerSnapshot;

const applyLogCorrectionMock = vi.mocked(applyLogCorrection);
const voidLogMock = vi.mocked(voidLog);

describe("log-correction-workflow", () => {
  beforeEach(() => {
    applyLogCorrectionMock.mockReset();
    applyLogCorrectionMock.mockResolvedValue({ logId: "generated-default" });
    voidLogMock.mockReset();
    voidLogMock.mockResolvedValue(undefined);
  });

  it("単一タンクID訂正をraw reasonとexact replace payloadで1回だけ委譲し、core結果を返す", async () => {
    const coreResult = { logId: "revision-001" };
    const resolveActor = vi.fn(() => ACTOR_A);
    applyLogCorrectionMock.mockResolvedValueOnce(coreResult);

    const result = await correctDashboardLogTankId({
      targetLogId: "target-log-001",
      tankId: "A-01",
      reason: "  abc  ",
      editedByRole: "一般",
      resolveActor,
    });

    expect(result).toBe(coreResult);
    expect(resolveActor).toHaveBeenCalledTimes(1);
    expect(applyLogCorrectionMock).toHaveBeenCalledTimes(1);
    expect(applyLogCorrectionMock.mock.calls[0]).toStrictEqual([
      {
        targetLogId: "target-log-001",
        mode: "replace",
        patch: {
          tankId: "A-01",
        },
        reason: "  abc  ",
        editor: ACTOR_A,
        editedByRole: "一般",
      },
    ]);
    const coreInput = applyLogCorrectionMock.mock.calls[0][0];
    expect(Object.keys(coreInput).sort()).toStrictEqual([
      "editedByRole",
      "editor",
      "mode",
      "patch",
      "reason",
      "targetLogId",
    ]);
    expect(Object.keys(coreInput.patch ?? {}).sort()).toStrictEqual(["tankId"]);
    expect(voidLogMock).toHaveBeenCalledTimes(0);
  });

  it("単一タンクID訂正のcore rejectionを同じError instanceで透過する", async () => {
    const failure = new Error("correction failed");
    const resolveActor = vi.fn(() => ACTOR_A);
    applyLogCorrectionMock.mockRejectedValueOnce(failure);

    const promise = correctDashboardLogTankId({
      targetLogId: "target-log-002",
      tankId: "B-02",
      reason: "訂正理由そのまま",
      editedByRole: "準管理者",
      resolveActor,
    });

    await expect(promise).rejects.toBe(failure);
    expect(resolveActor).toHaveBeenCalledTimes(1);
    expect(applyLogCorrectionMock).toHaveBeenCalledTimes(1);
    expect(voidLogMock).toHaveBeenCalledTimes(0);
  });

  it("単一タンクID訂正のactor resolver failureを同じError instanceで透過しcoreを呼ばない", async () => {
    const failure = new Error("actor unavailable");
    const resolveActor = vi.fn((): OperationActor => {
      throw failure;
    });

    const promise = correctDashboardLogTankId({
      targetLogId: "target-log-003",
      tankId: "C-03",
      reason: "訂正理由そのまま",
      editedByRole: "管理者",
      resolveActor,
    });

    await expect(promise).rejects.toBe(failure);
    expect(resolveActor).toHaveBeenCalledTimes(1);
    expect(applyLogCorrectionMock).toHaveBeenCalledTimes(0);
    expect(voidLogMock).toHaveBeenCalledTimes(0);
  });

  it("単一取消をraw reasonとexact payloadで1回だけ委譲する", async () => {
    const resolveActor = vi.fn(() => ACTOR_B);

    const result = await voidDashboardLog({
      logId: "void-log-001",
      reason: "  xyz  ",
      voidedByRole: "準管理者",
      resolveActor,
    });

    expect(result).toBeUndefined();
    expect(resolveActor).toHaveBeenCalledTimes(1);
    expect(voidLogMock).toHaveBeenCalledTimes(1);
    expect(voidLogMock.mock.calls[0]).toStrictEqual([
      {
        logId: "void-log-001",
        voider: ACTOR_B,
        voidedByRole: "準管理者",
        reason: "  xyz  ",
      },
    ]);
    expect(Object.keys(voidLogMock.mock.calls[0][0]).sort()).toStrictEqual([
      "logId",
      "reason",
      "voidedByRole",
      "voider",
    ]);
    expect(applyLogCorrectionMock).toHaveBeenCalledTimes(0);
  });

  it("単一取消のcore rejectionを同じError instanceで透過する", async () => {
    const failure = new Error("void failed");
    const resolveActor = vi.fn(() => ACTOR_B);
    voidLogMock.mockRejectedValueOnce(failure);

    const promise = voidDashboardLog({
      logId: "void-log-002",
      reason: "取消理由そのまま",
      voidedByRole: "一般",
      resolveActor,
    });

    await expect(promise).rejects.toBe(failure);
    expect(resolveActor).toHaveBeenCalledTimes(1);
    expect(voidLogMock).toHaveBeenCalledTimes(1);
    expect(applyLogCorrectionMock).toHaveBeenCalledTimes(0);
  });

  it("単一取消のactor resolver failureを同じError instanceで透過しcoreを呼ばない", async () => {
    const failure = new Error("actor unavailable");
    const resolveActor = vi.fn((): OperationActor => {
      throw failure;
    });

    const promise = voidDashboardLog({
      logId: "void-log-003",
      reason: "取消理由そのまま",
      voidedByRole: "管理者",
      resolveActor,
    });

    await expect(promise).rejects.toBe(failure);
    expect(resolveActor).toHaveBeenCalledTimes(1);
    expect(voidLogMock).toHaveBeenCalledTimes(0);
    expect(applyLogCorrectionMock).toHaveBeenCalledTimes(0);
  });

  it("一括貸出先変更を入力順に逐次実行し、各itemでactorを解決する", async () => {
    const first = createDeferred<{ logId: string }>();
    const second = createDeferred<{ logId: string }>();
    const third = createDeferred<{ logId: string }>();
    applyLogCorrectionMock
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
      .mockImplementationOnce(() => third.promise);

    const actors = [ACTOR_A, ACTOR_B, ACTOR_C];
    let actorIndex = 0;
    const resolveActor = vi.fn(() => actors[actorIndex++]!);

    const promise = correctDashboardLogLocations({
      logs: [
        { id: "log-c", tankId: "C-03" },
        { id: "log-a", tankId: "A-01" },
        { id: "log-b", tankId: "B-02" },
      ],
      location: "検証貸出先",
      customer: CUSTOMER,
      reason: "  loc  ",
      editedByRole: "一般",
      resolveActor,
    });

    expect(resolveActor).toHaveBeenCalledTimes(1);
    expect(applyLogCorrectionMock).toHaveBeenCalledTimes(1);

    first.resolve({ logId: "revision-c" });
    await flushMicrotasks();
    expect(resolveActor).toHaveBeenCalledTimes(2);
    expect(applyLogCorrectionMock).toHaveBeenCalledTimes(2);

    second.resolve({ logId: "revision-a" });
    await flushMicrotasks();
    expect(resolveActor).toHaveBeenCalledTimes(3);
    expect(applyLogCorrectionMock).toHaveBeenCalledTimes(3);

    third.resolve({ logId: "revision-b" });
    await expect(promise).resolves.toStrictEqual([]);

    expect(applyLogCorrectionMock.mock.calls).toStrictEqual([
      [
        {
          targetLogId: "log-c",
          mode: "replace",
          patch: {
            location: "検証貸出先",
            customer: CUSTOMER,
          },
          reason: "  loc  ",
          editor: ACTOR_A,
          editedByRole: "一般",
        },
      ],
      [
        {
          targetLogId: "log-a",
          mode: "replace",
          patch: {
            location: "検証貸出先",
            customer: CUSTOMER,
          },
          reason: "  loc  ",
          editor: ACTOR_B,
          editedByRole: "一般",
        },
      ],
      [
        {
          targetLogId: "log-b",
          mode: "replace",
          patch: {
            location: "検証貸出先",
            customer: CUSTOMER,
          },
          reason: "  loc  ",
          editor: ACTOR_C,
          editedByRole: "一般",
        },
      ],
    ]);
    applyLogCorrectionMock.mock.calls.forEach(([coreInput]) => {
      expect(Object.keys(coreInput).sort()).toStrictEqual([
        "editedByRole",
        "editor",
        "mode",
        "patch",
        "reason",
        "targetLogId",
      ]);
      expect(Object.keys(coreInput.patch ?? {}).sort()).toStrictEqual([
        "customer",
        "location",
      ]);
    });
    expect(voidLogMock).toHaveBeenCalledTimes(0);
  });

  it("一括貸出先変更でcustomer nullを省略せずexact patchに含める", async () => {
    const resolveActor = vi.fn(() => ACTOR_A);

    const result = await correctDashboardLogLocations({
      logs: [{ id: "inhouse-log", tankId: "I-01" }],
      location: "自社",
      customer: null,
      reason: "自社利用先へ訂正",
      editedByRole: "管理者",
      resolveActor,
    });

    expect(result).toStrictEqual([]);
    expect(applyLogCorrectionMock.mock.calls[0]).toStrictEqual([
      {
        targetLogId: "inhouse-log",
        mode: "replace",
        patch: {
          location: "自社",
          customer: null,
        },
        reason: "自社利用先へ訂正",
        editor: ACTOR_A,
        editedByRole: "管理者",
      },
    ]);
    const patch = applyLogCorrectionMock.mock.calls[0][0].patch;
    expect(Object.keys(patch ?? {}).sort()).toStrictEqual([
      "customer",
      "location",
    ]);
    expect(patch).toHaveProperty("customer", null);
    expect(voidLogMock).toHaveBeenCalledTimes(0);
  });

  it("一括貸出先変更はitem失敗を入力順のstructured failureへ変換し後続を継続する", async () => {
    applyLogCorrectionMock.mockImplementation(({ targetLogId }) => {
      if (targetLogId === "log-b") {
        return Promise.reject(new Error("correction failed"));
      }
      if (targetLogId === "log-c") {
        return Promise.reject("plain failure");
      }
      return Promise.resolve({ logId: `revision-${targetLogId}` });
    });
    const resolveActor = vi.fn(() => ACTOR_A);

    const result = await correctDashboardLogLocations({
      logs: [
        { id: "log-a", tankId: "A-01" },
        { id: "log-b", tankId: "B-02" },
        { id: "log-c", tankId: "C-03" },
        { id: "log-d", tankId: "D-04" },
      ],
      location: "訂正先",
      customer: CUSTOMER,
      reason: "貸出先訂正理由",
      editedByRole: "準管理者",
      resolveActor,
    });

    expect(result.map(({ tankId, error }) => [
      tankId,
      error instanceof Error ? error.message : String(error),
    ])).toStrictEqual([
      ["B-02", "correction failed"],
      ["C-03", "plain failure"],
    ]);
    expect(resolveActor).toHaveBeenCalledTimes(4);
    expect(applyLogCorrectionMock).toHaveBeenCalledTimes(4);
    expect(
      applyLogCorrectionMock.mock.calls.map(([coreInput]) => coreInput.targetLogId),
    ).toStrictEqual(["log-a", "log-b", "log-c", "log-d"]);
    expect(voidLogMock).toHaveBeenCalledTimes(0);
  });

  it("一括貸出先変更はactor resolver失敗を該当itemだけのfailureにして後続を継続する", async () => {
    const failure = new Error("actor unavailable");
    const resolveActor = vi.fn(() => ACTOR_A);
    resolveActor
      .mockImplementationOnce(() => ACTOR_A)
      .mockImplementationOnce(() => {
        throw failure;
      })
      .mockImplementationOnce(() => ACTOR_C);

    const result = await correctDashboardLogLocations({
      logs: [
        { id: "log-a", tankId: "A-01" },
        { id: "log-b", tankId: "B-02" },
        { id: "log-c", tankId: "C-03" },
      ],
      location: "訂正先",
      customer: CUSTOMER,
      reason: "貸出先訂正理由",
      editedByRole: "一般",
      resolveActor,
    });

    expect(result).toStrictEqual([{ tankId: "B-02", error: failure }]);
    expect(resolveActor).toHaveBeenCalledTimes(3);
    expect(applyLogCorrectionMock).toHaveBeenCalledTimes(2);
    expect(
      applyLogCorrectionMock.mock.calls.map(([coreInput]) => coreInput.targetLogId),
    ).toStrictEqual(["log-a", "log-c"]);
    expect(voidLogMock).toHaveBeenCalledTimes(0);
  });

  it("一括取消を入力順に逐次実行し、各itemでactorを解決する", async () => {
    const first = createDeferred<void>();
    const second = createDeferred<void>();
    const third = createDeferred<void>();
    voidLogMock
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
      .mockImplementationOnce(() => third.promise);

    const actors = [ACTOR_C, ACTOR_A, ACTOR_B];
    let actorIndex = 0;
    const resolveActor = vi.fn(() => actors[actorIndex++]!);

    const promise = voidDashboardLogs({
      logs: [
        { id: "void-c", tankId: "C-03" },
        { id: "void-a", tankId: "A-01" },
        { id: "void-b", tankId: "B-02" },
      ],
      reason: "  void  ",
      voidedByRole: "管理者",
      resolveActor,
    });

    expect(resolveActor).toHaveBeenCalledTimes(1);
    expect(voidLogMock).toHaveBeenCalledTimes(1);

    first.resolve(undefined);
    await flushMicrotasks();
    expect(resolveActor).toHaveBeenCalledTimes(2);
    expect(voidLogMock).toHaveBeenCalledTimes(2);

    second.resolve(undefined);
    await flushMicrotasks();
    expect(resolveActor).toHaveBeenCalledTimes(3);
    expect(voidLogMock).toHaveBeenCalledTimes(3);

    third.resolve(undefined);
    await expect(promise).resolves.toStrictEqual([]);

    expect(voidLogMock.mock.calls).toStrictEqual([
      [
        {
          logId: "void-c",
          voider: ACTOR_C,
          voidedByRole: "管理者",
          reason: "  void  ",
        },
      ],
      [
        {
          logId: "void-a",
          voider: ACTOR_A,
          voidedByRole: "管理者",
          reason: "  void  ",
        },
      ],
      [
        {
          logId: "void-b",
          voider: ACTOR_B,
          voidedByRole: "管理者",
          reason: "  void  ",
        },
      ],
    ]);
    voidLogMock.mock.calls.forEach(([coreInput]) => {
      expect(Object.keys(coreInput).sort()).toStrictEqual([
        "logId",
        "reason",
        "voidedByRole",
        "voider",
      ]);
    });
    expect(applyLogCorrectionMock).toHaveBeenCalledTimes(0);
  });

  it("一括取消はitem失敗を入力順のstructured failureへ変換し後続を継続する", async () => {
    voidLogMock.mockImplementation(({ logId }) => {
      if (logId === "void-b") {
        return Promise.reject(new Error("void failed"));
      }
      if (logId === "void-c") {
        return Promise.reject("plain failure");
      }
      return Promise.resolve();
    });
    const resolveActor = vi.fn(() => ACTOR_B);

    const result = await voidDashboardLogs({
      logs: [
        { id: "void-a", tankId: "A-01" },
        { id: "void-b", tankId: "B-02" },
        { id: "void-c", tankId: "C-03" },
        { id: "void-d", tankId: "D-04" },
      ],
      reason: "一括取消理由",
      voidedByRole: "準管理者",
      resolveActor,
    });

    expect(result.map(({ tankId, error }) => [
      tankId,
      error instanceof Error ? error.message : String(error),
    ])).toStrictEqual([
      ["B-02", "void failed"],
      ["C-03", "plain failure"],
    ]);
    expect(resolveActor).toHaveBeenCalledTimes(4);
    expect(voidLogMock).toHaveBeenCalledTimes(4);
    expect(
      voidLogMock.mock.calls.map(([coreInput]) => coreInput.logId),
    ).toStrictEqual(["void-a", "void-b", "void-c", "void-d"]);
    expect(applyLogCorrectionMock).toHaveBeenCalledTimes(0);
  });

  it("一括取消はactor resolver失敗を該当itemだけのfailureにして後続を継続する", async () => {
    const failure = new Error("actor unavailable");
    const resolveActor = vi.fn(() => ACTOR_A);
    resolveActor
      .mockImplementationOnce(() => ACTOR_A)
      .mockImplementationOnce(() => {
        throw failure;
      })
      .mockImplementationOnce(() => ACTOR_C);

    const result = await voidDashboardLogs({
      logs: [
        { id: "void-a", tankId: "A-01" },
        { id: "void-b", tankId: "B-02" },
        { id: "void-c", tankId: "C-03" },
      ],
      reason: "一括取消理由",
      voidedByRole: "一般",
      resolveActor,
    });

    expect(result).toStrictEqual([{ tankId: "B-02", error: failure }]);
    expect(resolveActor).toHaveBeenCalledTimes(3);
    expect(voidLogMock).toHaveBeenCalledTimes(2);
    expect(
      voidLogMock.mock.calls.map(([coreInput]) => coreInput.logId),
    ).toStrictEqual(["void-a", "void-c"]);
    expect(applyLogCorrectionMock).toHaveBeenCalledTimes(0);
  });

  it("両一括serviceは空配列でresolverもcoreも呼ばず空failureを返す", async () => {
    const resolveActor = vi.fn(() => ACTOR_A);

    await expect(correctDashboardLogLocations({
      logs: [],
      location: "訂正先",
      customer: null,
      reason: "貸出先訂正理由",
      editedByRole: "一般",
      resolveActor,
    })).resolves.toStrictEqual([]);

    await expect(voidDashboardLogs({
      logs: [],
      reason: "一括取消理由",
      voidedByRole: "一般",
      resolveActor,
    })).resolves.toStrictEqual([]);

    expect(resolveActor).toHaveBeenCalledTimes(0);
    expect(applyLogCorrectionMock).toHaveBeenCalledTimes(0);
    expect(voidLogMock).toHaveBeenCalledTimes(0);
  });
});

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
