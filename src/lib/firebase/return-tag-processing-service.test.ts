import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OperationActor, ReturnCondition } from "@/lib/operation-context";
import {
  StaleTankCycleError,
  type TankOperationInput,
  type TankOperationWriter,
} from "@/lib/tank-operation";
import { confirmPendingReturnRequests } from "./return-tag-processing-service";

const mocks = vi.hoisted(() => ({
  db: { kind: "mock-db" },
  doc: vi.fn(),
  serverTimestamp: vi.fn(),
  getTank: vi.fn(),
  applyBulkTankOperations: vi.fn(),
}));

vi.mock("firebase/firestore", () => ({
  doc: mocks.doc,
  serverTimestamp: mocks.serverTimestamp,
}));

vi.mock("@/lib/firebase/config", () => ({
  db: mocks.db,
}));

vi.mock("@/lib/firebase/repositories", () => ({
  tanksRepository: {
    getTank: mocks.getTank,
  },
}));

vi.mock("@/lib/tank-operation", () => ({
  applyBulkTankOperations: mocks.applyBulkTankOperations,
  StaleTankCycleError: class StaleTankCycleError extends Error {
    readonly name = "StaleTankCycleError";
    readonly issues: readonly unknown[];

    constructor(issues: readonly unknown[]) {
      super("stale tank cycle");
      this.issues = issues;
    }
  },
}));

type ConfirmationInput = Parameters<typeof confirmPendingReturnRequests>[0];
type RequestItem = ConfirmationInput["group"]["items"][number];

const ACTOR = {
  staffId: "staff-001",
  staffName: "Operator A",
  staffEmail: "operator@example.com",
} satisfies OperationActor;

function createItem(
  id: string,
  tankId: string,
  expectedLatestLogId?: unknown,
): RequestItem {
  return {
    id,
    customerId: "customer-001",
    tankId,
    condition: "unused",
    ...(arguments.length >= 3 ? { expectedLatestLogId } : {}),
  };
}

function createInput(items: RequestItem[]): ConfirmationInput {
  return {
    group: {
      customerId: items[0]?.customerId ?? "customer-001",
      customerName: "Ocean Shop",
      items,
    },
    selections: Object.fromEntries(
      items.map((item) => [
        item.id,
        { selected: true, condition: item.condition as ReturnCondition },
      ]),
    ),
    actor: ACTOR,
  };
}

async function captureOperations(
  items: RequestItem[],
): Promise<TankOperationInput[]> {
  await confirmPendingReturnRequests(createInput(items));
  expect(mocks.applyBulkTankOperations).toHaveBeenCalledTimes(1);
  expect(mocks.applyBulkTankOperations.mock.calls[0][2]).toEqual({
    recoveryConfirmationResolver: undefined,
  });
  return mocks.applyBulkTankOperations.mock.calls[0][0] as TankOperationInput[];
}

describe("return tag cycle marker consumption", () => {
  beforeEach(() => {
    mocks.doc.mockReset();
    mocks.serverTimestamp.mockReset();
    mocks.getTank.mockReset();
    mocks.applyBulkTankOperations.mockReset();

    mocks.getTank.mockResolvedValue({
      status: "lent",
      location: "Ocean Shop",
    });
    mocks.applyBulkTankOperations.mockResolvedValue([]);
  });

  it("marker の観測値を trim せず exact な expectedCycle として渡す", async () => {
    const item = createItem("return-001", "A-01", " log-001 ");
    item.customerId = " customer-001 ";

    const [operation] = await captureOperations([item]);

    expect(operation.expectedCycle).toEqual({
      customerId: " customer-001 ",
      latestLogId: " log-001 ",
    });
  });

  it("複数 tank の各 marker を正しい expectedCycle として渡す", async () => {
    const first = createItem("return-001", "A-01", "log-001");
    const second = createItem("return-002", "A-02", "log-002");

    const operations = await captureOperations([first, second]);

    expect(operations.map(({ tankId, expectedCycle }) => ({ tankId, expectedCycle }))).toEqual([
      {
        tankId: "A-01",
        expectedCycle: { customerId: "customer-001", latestLogId: "log-001" },
      },
      {
        tankId: "A-02",
        expectedCycle: { customerId: "customer-001", latestLogId: "log-002" },
      },
    ]);
  });

  it("marker field が無い legacy pending は expectedCycle なしで処理を継続する", async () => {
    const [operation] = await captureOperations([
      createItem("return-001", "A-01"),
    ]);

    expect(operation).not.toHaveProperty("expectedCycle");
  });

  it("null marker は expectedCycle を設定しない", async () => {
    const [operation] = await captureOperations([
      createItem("return-001", "A-01", null),
    ]);

    expect(operation).not.toHaveProperty("expectedCycle");
  });

  it.each(["", " \t "])(
    "空または空白 marker (%j) は expectedCycle を設定しない",
    async (marker) => {
      const [operation] = await captureOperations([
        createItem("return-001", "A-01", marker),
      ]);

      expect(operation).not.toHaveProperty("expectedCycle");
    },
  );

  it.each([123, { id: "log-001" }, ["log-001"], true])(
    "非 string marker (%j) は expectedCycle を設定しない",
    async (marker) => {
      const [operation] = await captureOperations([
        createItem("return-001", "A-01", marker),
      ]);

      expect(operation).not.toHaveProperty("expectedCycle");
    },
  );

  it.each([undefined, "", " \t "])(
    "customerId が欠落または空 (%j) なら latestLogId だけの expectedCycle を作らない",
    async (customerId) => {
      const item = createItem("return-001", "A-01", "log-001");
      Reflect.set(item, "customerId", customerId);

      const [operation] = await captureOperations([item]);

      expect(operation).not.toHaveProperty("expectedCycle");
    },
  );

  it("marker あり・なしが混在しても marker あり側の expectedCycle を skip しない", async () => {
    const guarded = createItem("return-001", "A-01", "log-001");
    const legacy = createItem("return-002", "A-02");

    const operations = await captureOperations([guarded, legacy]);

    expect(operations[0].expectedCycle).toEqual({
      customerId: "customer-001",
      latestLogId: "log-001",
    });
    expect(operations[1]).not.toHaveProperty("expectedCycle");
  });

  it("StaleTankCycleError 時は transaction completed 更新を実行しない", async () => {
    const staleError = new StaleTankCycleError([{
      tankId: "A-01",
      field: "latestLogId",
      reason: "mismatch",
    }]);
    mocks.applyBulkTankOperations.mockRejectedValueOnce(staleError);

    await expect(confirmPendingReturnRequests(createInput([
      createItem("return-001", "A-01", "log-001"),
    ]))).rejects.toBe(staleError);

    expect(mocks.applyBulkTankOperations).toHaveBeenCalledTimes(1);
    expect(mocks.doc).not.toHaveBeenCalled();
    expect(mocks.serverTimestamp).not.toHaveBeenCalled();
    const extraOps = mocks.applyBulkTankOperations.mock.calls[0][1] as (
      writer: TankOperationWriter,
    ) => void;
    expect(mocks.applyBulkTankOperations.mock.calls[0][2]).toEqual({
      recoveryConfirmationResolver: undefined,
    });
    const writer = {
      set: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    } satisfies TankOperationWriter;
    expect(extraOps).toEqual(expect.any(Function));
    expect(writer.update).not.toHaveBeenCalled();
  });
});
