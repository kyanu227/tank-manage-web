/** Rulesでtank/log/return transactionを相互検証する最も重い経路の実測上限。 */
export const MAX_ATOMIC_TANK_OPERATIONS = 10;

export function assertAtomicTankOperationCount(count: number): void {
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error("一括操作件数が不正です。");
  }
  if (count > MAX_ATOMIC_TANK_OPERATIONS) {
    throw new Error(
      `一度に操作できるタンクは${MAX_ATOMIC_TANK_OPERATIONS}本までです。対象件数を減らしてください。`,
    );
  }
}
