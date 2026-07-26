import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OperationActor } from "@/lib/operation-context";
import type { PendingOrder } from "@/lib/order-types";
import type { TankOperationWriter } from "@/lib/tank-operation";
import {
  approveOrder,
  fulfillOrder,
  getOrderApprovalValidationError,
  validateOrderFulfillment,
} from "@/lib/firebase/order-fulfillment-service";

const mocks = vi.hoisted(() => ({
  db: { kind: "mock-db" },
  doc: vi.fn(),
  serverTimestamp: vi.fn(),
  updateDoc: vi.fn(),
  applyBulkTankOperations: vi.fn(),
}));

vi.mock("firebase/firestore", () => ({
  doc: mocks.doc,
  serverTimestamp: mocks.serverTimestamp,
  updateDoc: mocks.updateDoc,
}));

vi.mock("@/lib/firebase/config", () => ({
  db: mocks.db,
}));

vi.mock("@/lib/tank-operation", () => ({
  applyBulkTankOperations: mocks.applyBulkTankOperations,
}));

const ACTOR = {
  staffId: "staff-001",
  staffName: "山田 太郎",
  staffEmail: "yamada@example.com",
  role: "worker",
  rank: "A",
} satisfies OperationActor;

const ORDER = {
  id: "order-001",
  customerId: "customer-001",
  customerName: "テストダイビング",
  status: "approved",
  items: [
    { tankType: "スチール10L", quantity: 2 },
    { tankType: "アルミ10L", quantity: 1 },
  ],
  createdAt: undefined,
} satisfies PendingOrder;

function makeOrder(overrides: Partial<PendingOrder> = {}): PendingOrder {
  return {
    ...ORDER,
    ...overrides,
  };
}

describe("order fulfillment validation", () => {
  it("customerIdが空なら現行の承認エラー文言を返す", () => {
    expect(getOrderApprovalValidationError(makeOrder({ customerId: "" }))).toBe(
      "顧客に紐付いていない受注は承認できません。管理画面で紐付けてください。",
    );
  });

  it("customerIdがあれば承認validationに成功する", () => {
    expect(getOrderApprovalValidationError(ORDER)).toBeNull();
  });

  it("複数種別の必要本数が完全一致するとvalid tankの入力順を維持する", () => {
    const scannedTanks = [
      { id: "B-01", valid: true },
      { id: "A-02", valid: true },
      { id: "A-01", valid: true },
    ];

    const result = validateOrderFulfillment({
      order: ORDER,
      scannedTanks,
      allTanks: {
        "A-01": { status: "充填済み", type: "スチール10L" },
        "A-02": { status: "filled", type: "スチール10L" },
        "B-01": { status: "充填済み", type: "アルミ10L" },
      },
    });

    expect(result).toEqual({
      ok: true,
      validTanks: scannedTanks,
    });
  });

  it("総本数が不足すると現行の数量不一致文言を返す", () => {
    const result = validateOrderFulfillment({
      order: makeOrder({
        items: [{ tankType: "スチール10L", quantity: 2 }],
      }),
      scannedTanks: [{ id: "A-01", valid: true }],
      allTanks: {
        "A-01": { type: "スチール10L" },
      },
    });

    expect(result).toEqual({
      ok: false,
      message: "数量が一致しません (1/2)",
    });
  });

  it("総本数が一致しても種別ごとの数量が違えば不一致にする", () => {
    const result = validateOrderFulfillment({
      order: makeOrder({
        items: [
          { tankType: "スチール10L", quantity: 1 },
          { tankType: "アルミ10L", quantity: 1 },
        ],
      }),
      scannedTanks: [
        { id: "A-01", valid: true },
        { id: "A-02", valid: true },
      ],
      allTanks: {
        "A-01": { type: "スチール10L" },
        "A-02": { type: "スチール10L" },
      },
    });

    expect(result).toEqual({
      ok: false,
      message: "数量が一致しません (2/2)",
    });
  });

  it("valid=falseのscanをvalidTanksと数量集計から除外する", () => {
    const result = validateOrderFulfillment({
      order: makeOrder({
        items: [{ tankType: "スチール10L", quantity: 1 }],
      }),
      scannedTanks: [
        { id: "INVALID-01", valid: false },
        { id: "A-01", valid: true },
      ],
      allTanks: {
        "INVALID-01": { type: "スチール10L" },
        "A-01": { type: "スチール10L" },
      },
    });

    expect(result).toEqual({
      ok: true,
      validTanks: [{ id: "A-01", valid: true }],
    });
  });

  it("allTanksに存在しないIDのtypeを空文字として集計する", () => {
    const result = validateOrderFulfillment({
      order: makeOrder({
        items: [{ tankType: "", quantity: 1 }],
      }),
      scannedTanks: [{ id: "MISSING-01", valid: true }],
      allTanks: {},
    });

    expect(result).toEqual({
      ok: true,
      validTanks: [{ id: "MISSING-01", valid: true }],
    });
  });

  it("重複するorder itemも各itemの数量とscan数を厳密に比較する", () => {
    const result = validateOrderFulfillment({
      order: makeOrder({
        items: [
          { tankType: "スチール10L", quantity: 1 },
          { tankType: "スチール10L", quantity: 2 },
        ],
      }),
      scannedTanks: [
        { id: "A-01", valid: true },
        { id: "A-02", valid: true },
        { id: "A-03", valid: true },
      ],
      allTanks: {
        "A-01": { type: "スチール10L" },
        "A-02": { type: "スチール10L" },
        "A-03": { type: "スチール10L" },
      },
    });

    expect(result).toEqual({
      ok: false,
      message: "数量が一致しません (3/3)",
    });
  });
});

describe("order fulfillment write contract", () => {
  beforeEach(() => {
    mocks.doc.mockReset();
    mocks.serverTimestamp.mockReset();
    mocks.updateDoc.mockReset();
    mocks.applyBulkTankOperations.mockReset();

    mocks.doc.mockImplementation(
      (_db: unknown, collectionName: string, id: string) => ({
        path: `${collectionName}/${id}`,
      }),
    );
    mocks.updateDoc.mockResolvedValue(undefined);
    mocks.applyBulkTankOperations.mockResolvedValue([]);
  });

  it("approveOrderはtransactions documentを現行のactor・timestamp payloadで1回更新する", async () => {
    const approvedAt = { kind: "approved-at" };
    const updatedAt = { kind: "updated-at" };
    mocks.serverTimestamp
      .mockReturnValueOnce(approvedAt)
      .mockReturnValueOnce(updatedAt);

    await approveOrder(ORDER.id, ACTOR);

    expect(mocks.doc).toHaveBeenCalledTimes(1);
    expect(mocks.doc).toHaveBeenCalledWith(
      mocks.db,
      "transactions",
      ORDER.id,
    );
    expect(mocks.serverTimestamp).toHaveBeenCalledTimes(2);
    expect(mocks.updateDoc).toHaveBeenCalledTimes(1);
    expect(mocks.updateDoc).toHaveBeenCalledWith(
      { path: `transactions/${ORDER.id}` },
      {
        status: "approved",
        approvedAt,
        approvedBy: ACTOR.staffName,
        approvedByStaffId: ACTOR.staffId,
        approvedByStaffName: ACTOR.staffName,
        approvedByStaffEmail: ACTOR.staffEmail,
        updatedAt,
      },
    );
  });

  it("approveOrderはactorにemailがなければemail fieldを保存しない", async () => {
    const actorWithoutEmail: OperationActor = {
      staffId: "staff-002",
      staffName: "佐藤 花子",
    };
    mocks.serverTimestamp
      .mockReturnValueOnce({ kind: "approved-at" })
      .mockReturnValueOnce({ kind: "updated-at" });

    await approveOrder(ORDER.id, actorWithoutEmail);

    const payload = mocks.updateDoc.mock.calls[0][1];
    expect(payload).toEqual({
      status: "approved",
      approvedAt: { kind: "approved-at" },
      approvedBy: actorWithoutEmail.staffName,
      approvedByStaffId: actorWithoutEmail.staffId,
      approvedByStaffName: actorWithoutEmail.staffName,
      updatedAt: { kind: "updated-at" },
    });
    expect(payload).not.toHaveProperty("approvedByStaffEmail");
  });

  it("fulfillOrderは入力順のoperation payloadとextraOps内の完了更新を維持する", async () => {
    const validTanks = [
      { id: "A-01" },
      { id: "B-02" },
    ];
    const allTanks = {
      "A-01": { status: "充填済み" },
      "B-02": { status: "filled" },
    };

    await fulfillOrder({
      order: ORDER,
      validTanks,
      allTanks,
      actor: ACTOR,
    });

    expect(mocks.applyBulkTankOperations).toHaveBeenCalledTimes(1);
    const [operations, extraOps] = mocks.applyBulkTankOperations.mock.calls[0];
    expect(operations).toEqual([
      {
        tankId: "A-01",
        transitionAction: "貸出",
        logAction: "受注貸出",
        currentStatus: "充填済み",
        context: {
          actor: ACTOR,
          customer: {
            customerId: ORDER.customerId,
            customerName: ORDER.customerName,
          },
          transactionId: ORDER.id,
          source: "order_fulfillment",
          workflow: "order",
        },
        location: ORDER.customerName,
        tankNote: `受注ID: ${ORDER.id}`,
        logNote: `受注ID: ${ORDER.id}`,
      },
      {
        tankId: "B-02",
        transitionAction: "貸出",
        logAction: "受注貸出",
        currentStatus: "filled",
        context: {
          actor: ACTOR,
          customer: {
            customerId: ORDER.customerId,
            customerName: ORDER.customerName,
          },
          transactionId: ORDER.id,
          source: "order_fulfillment",
          workflow: "order",
        },
        location: ORDER.customerName,
        tankNote: `受注ID: ${ORDER.id}`,
        logNote: `受注ID: ${ORDER.id}`,
      },
    ]);
    expect(extraOps).toEqual(expect.any(Function));

    expect(mocks.doc).toHaveBeenCalledTimes(0);
    expect(mocks.serverTimestamp).toHaveBeenCalledTimes(0);
    expect(mocks.updateDoc).toHaveBeenCalledTimes(0);

    const writer = {
      set: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    } satisfies TankOperationWriter;
    const fulfilledAt = { kind: "fulfilled-at" };
    const updatedAt = { kind: "updated-at" };
    mocks.serverTimestamp
      .mockReturnValueOnce(fulfilledAt)
      .mockReturnValueOnce(updatedAt);

    extraOps(writer);

    expect(mocks.doc).toHaveBeenCalledTimes(1);
    expect(mocks.doc).toHaveBeenCalledWith(
      mocks.db,
      "transactions",
      ORDER.id,
    );
    expect(mocks.serverTimestamp).toHaveBeenCalledTimes(2);
    expect(writer.update).toHaveBeenCalledTimes(1);
    expect(writer.update).toHaveBeenCalledWith(
      { path: `transactions/${ORDER.id}` },
      {
        status: "completed",
        fulfilledAt,
        fulfilledBy: ACTOR.staffName,
        fulfilledByStaffId: ACTOR.staffId,
        fulfilledByStaffName: ACTOR.staffName,
        fulfilledByStaffEmail: ACTOR.staffEmail,
        updatedAt,
      },
    );
    expect(writer.set).toHaveBeenCalledTimes(0);
    expect(writer.delete).toHaveBeenCalledTimes(0);
    expect(mocks.updateDoc).toHaveBeenCalledTimes(0);
  });
});
