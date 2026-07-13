/** 全tank operation共通のapplication上限。staff直接recoveryで100件まで実測済み。 */
export const MAX_ATOMIC_TANK_OPERATIONS = 100;

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
