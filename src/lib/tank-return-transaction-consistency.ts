import type { TankStatusCode } from "./tank-action-status-codes";

export type ReturnTransactionCustomerConsistencyInput = {
  tankId: string;
  currentStatus: TankStatusCode;
  latestLogId: string | null;
  tankCustomerId?: string | null;
  contextCustomerId?: string;
  transaction: {
    id: string;
    exists: boolean;
    type?: unknown;
    status?: unknown;
    tankId?: unknown;
    customerId?: unknown;
  };
};

/**
 * 返却申請と、transaction実行時点のタンク保有顧客をcustomerIdで検証する。
 * 全件の検証を最初のwriteより前に呼び出すことが、一括処理のatomic性の前提。
 */
export function assertReturnTransactionCustomerConsistency(
  inputs: readonly ReturnTransactionCustomerConsistencyInput[],
): void {
  const transactionIds = new Set<string>();

  inputs.forEach((input) => {
    const label = `[${input.tankId}]`;
    const transactionId = normalizeRequiredString(
      input.transaction.id,
      `${label} 返却transaction ID`,
    );
    if (transactionIds.has(transactionId)) {
      throw new Error(`${label} 同じ返却transactionが一括処理内で重複しています`);
    }
    transactionIds.add(transactionId);

    if (!input.transaction.exists) {
      throw new Error(`${label} 返却transactionが存在しません`);
    }
    if (input.transaction.type !== "return") {
      throw new Error(`${label} transactionが返却申請ではありません`);
    }
    if (input.transaction.status !== "pending_return") {
      throw new Error(`${label} 返却transactionは処理待ち状態ではありません`);
    }
    if (input.currentStatus !== "lent" && input.currentStatus !== "unreturned") {
      throw new Error(`${label} 返却申請の対象タンクは貸出中または未返却ではありません`);
    }
    normalizeRequiredString(
      input.latestLogId,
      `${label} 現在の貸出境界latestLogId`,
    );

    const transactionTankId = normalizeRequiredString(
      input.transaction.tankId,
      `${label} 返却transactionのtankId`,
    ).toUpperCase();
    if (transactionTankId !== input.tankId.trim().toUpperCase()) {
      throw new Error(`${label} 返却transactionの対象タンクが一致しません`);
    }

    const transactionCustomerId = normalizeRequiredString(
      input.transaction.customerId,
      `${label} 返却transactionのcustomerId`,
    );
    const tankCustomerId = normalizeRequiredString(
      input.tankCustomerId,
      `${label} 現在のタンク保有顧客customerId`,
    );
    const contextCustomerId = normalizeRequiredString(
      input.contextCustomerId,
      `${label} 操作contextのcustomerId`,
    );

    if (
      transactionCustomerId !== tankCustomerId
      || transactionCustomerId !== contextCustomerId
    ) {
      throw new Error(
        `${label} 返却申請の顧客と現在のタンク保有顧客が一致しません`,
      );
    }
  });
}

function normalizeRequiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label}がありません`);
  }
  return value.trim();
}
