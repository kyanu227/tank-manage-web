import { describe, expect, it } from "vitest";
import {
  assertReturnTransactionCustomerConsistency,
  type ReturnTransactionCustomerConsistencyInput,
} from "@/lib/tank-return-transaction-consistency";

describe("assertReturnTransactionCustomerConsistency", () => {
  it("単件の返却申請顧客と現holderが一致すれば通す", () => {
    expect(() => assertReturnTransactionCustomerConsistency([
      createInput({
        tankId: "A-01",
        transactionId: "return-a",
        transactionCustomerId: "customer-a",
        tankCustomerId: "customer-a",
        contextCustomerId: "customer-a",
      }),
    ])).not.toThrow();
  });

  it("単件の返却申請A社と現holder B社が不一致ならhard blockする", () => {
    expect(() => assertReturnTransactionCustomerConsistency([
      createInput({
        tankId: "A-01",
        transactionId: "return-a",
        transactionCustomerId: "customer-a",
        tankCustomerId: "customer-b",
        contextCustomerId: "customer-a",
      }),
    ])).toThrow("返却申請の顧客と現在のタンク保有顧客が一致しません");
  });

  it.each([
    {
      name: "tank holder customerId",
      mutate: (input: ReturnTransactionCustomerConsistencyInput) => ({
        ...input,
        tankCustomerId: undefined,
      }),
      message: "現在のタンク保有顧客customerIdがありません",
    },
    {
      name: "return transaction customerId",
      mutate: (input: ReturnTransactionCustomerConsistencyInput) => ({
        ...input,
        transaction: { ...input.transaction, customerId: undefined },
      }),
      message: "返却transactionのcustomerIdがありません",
    },
    {
      name: "operation context customerId",
      mutate: (input: ReturnTransactionCustomerConsistencyInput) => ({
        ...input,
        contextCustomerId: undefined,
      }),
      message: "操作contextのcustomerIdがありません",
    },
  ])("$name欠落で名前やlocationから推測しない", ({ mutate, message }) => {
    const input = createInput({
      tankId: "A-01",
      transactionId: "return-a",
      transactionCustomerId: "customer-a",
      tankCustomerId: "customer-a",
      contextCustomerId: "customer-a",
    });
    expect(() => assertReturnTransactionCustomerConsistency([mutate(input)]))
      .toThrow(message);
  });

  it("一括の1件で顧客不一致ならwrite宣言前に全件を停止する", () => {
    const validA = createInput({
      tankId: "A-01",
      transactionId: "return-a",
      transactionCustomerId: "customer-a",
      tankCustomerId: "customer-a",
      contextCustomerId: "customer-a",
    });
    const validB = createInput({
      tankId: "B-02",
      transactionId: "return-b",
      transactionCustomerId: "customer-b",
      tankCustomerId: "customer-b",
      contextCustomerId: "customer-b",
    });
    const mismatchedC = createInput({
      tankId: "C-03",
      transactionId: "return-c",
      transactionCustomerId: "customer-c",
      tankCustomerId: "customer-other",
      contextCustomerId: "customer-c",
    });
    let writesDeclared = false;

    expect(() => {
      // productionも全件の整合検証が終わった後だけwrite宣言へ進む。
      assertReturnTransactionCustomerConsistency([validA, validB, mismatchedC]);
      writesDeclared = true;
    }).toThrow("返却申請の顧客と現在のタンク保有顧客が一致しません");
    expect(writesDeclared).toBe(false);
  });
});

function createInput(input: {
  tankId: string;
  transactionId: string;
  transactionCustomerId: string;
  tankCustomerId: string;
  contextCustomerId: string;
}): ReturnTransactionCustomerConsistencyInput {
  return {
    tankId: input.tankId,
    currentStatus: "lent",
    latestLogId: `lend-${input.tankId}`,
    tankCustomerId: input.tankCustomerId,
    contextCustomerId: input.contextCustomerId,
    transaction: {
      id: input.transactionId,
      exists: true,
      type: "return",
      status: "pending_return",
      tankId: input.tankId,
      customerId: input.transactionCustomerId,
    },
  };
}
