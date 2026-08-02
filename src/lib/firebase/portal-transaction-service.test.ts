import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createTransaction: vi.fn<(...args: unknown[]) => Promise<string>>(),
}));

vi.mock("@/lib/firebase/repositories", () => ({
  transactionsRepository: {
    createTransaction: mocks.createTransaction,
  },
}));

import {
  createPortalReturnRequests,
  type CreatePortalReturnRequestsInput,
} from "./portal-transaction-service";

const IDENTITY = {
  kind: "linked",
  customerUserUid: "customer-user-1",
  customerId: "customer-1",
  customerName: "テスト顧客",
} as const;

function createInput(
  items: CreatePortalReturnRequestsInput["items"],
): CreatePortalReturnRequestsInput {
  return {
    identity: IDENTITY,
    items,
    source: "customer_portal",
  };
}

function createValidItem(tankId: string, expectedLatestLogId: string) {
  return {
    tankId,
    condition: "normal" as const,
    customerId: IDENTITY.customerId,
    expectedLatestLogId,
  };
}

describe("createPortalReturnRequests", () => {
  beforeEach(() => {
    mocks.createTransaction.mockReset();
    mocks.createTransaction
      .mockResolvedValueOnce("request-1")
      .mockResolvedValueOnce("request-2");
  });

  it("全件 valid なら全件の pending_return を作成する", async () => {
    await expect(createPortalReturnRequests(createInput([
      createValidItem("TANK-01", "log-01"),
      createValidItem("TANK-02", "log-02"),
    ]))).resolves.toEqual(["request-1", "request-2"]);

    expect(mocks.createTransaction).toHaveBeenCalledTimes(2);
  });

  it.each([
    {
      name: "expectedLatestLogId 欠落",
      invalidItem: {
        tankId: "TANK-02",
        condition: "normal",
        customerId: IDENTITY.customerId,
      },
    },
    {
      name: "customerId 欠落",
      invalidItem: {
        tankId: "TANK-02",
        condition: "normal",
        expectedLatestLogId: "log-02",
      },
    },
    {
      name: "expectedLatestLogId が空白",
      invalidItem: {
        tankId: "TANK-02",
        condition: "normal",
        customerId: IDENTITY.customerId,
        expectedLatestLogId: " \t ",
      },
    },
  ])("1件でも $name なら repository create を1件も呼ばない", async ({ invalidItem }) => {
    const input = createInput([
      createValidItem("TANK-01", "log-01"),
      invalidItem,
    ] as CreatePortalReturnRequestsInput["items"]);

    await expect(createPortalReturnRequests(input)).rejects.toThrow();
    expect(mocks.createTransaction).toHaveBeenCalledTimes(0);
  });

  it("customerId が identity と不一致なら repository create を呼ばない", async () => {
    const input = createInput([
      createValidItem("TANK-01", "log-01"),
      {
        ...createValidItem("TANK-02", "log-02"),
        customerId: "other-customer",
      },
    ]);

    await expect(createPortalReturnRequests(input)).rejects.toThrow(
      "Portal return customerId must match the linked identity.",
    );
    expect(mocks.createTransaction).toHaveBeenCalledTimes(0);
  });

  it("payload に marker を string で含め、undefined property を含めない", async () => {
    await createPortalReturnRequests(createInput([
      createValidItem(" TANK-01 ", " log-01 "),
    ]));

    expect(mocks.createTransaction).toHaveBeenCalledTimes(1);
    const payload = mocks.createTransaction.mock.calls[0][0] as Record<string, unknown>;
    expect(payload).toMatchObject({
      type: "return",
      status: "pending_return",
      tankId: "TANK-01",
      customerId: IDENTITY.customerId,
      expectedLatestLogId: " log-01 ",
    });
    expect(typeof payload.expectedLatestLogId).toBe("string");
    expect(Object.values(payload)).not.toContain(undefined);
  });
});
