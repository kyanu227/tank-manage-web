// 一つのtoggleで全層が開かないよう、CLI・service・lower RESTを独立して閉じる。
const RESET_CLI_PRODUCTION_EXECUTE_ENABLED = false as const;
const RESTORE_CLI_PRODUCTION_EXECUTE_ENABLED = false as const;
const RESET_SERVICE_PRODUCTION_EXECUTE_ENABLED = false as const;
const RESTORE_SERVICE_PRODUCTION_EXECUTE_ENABLED = false as const;
const FIRESTORE_REST_PRODUCTION_COMMIT_ENABLED = false as const;

class ProductionCutoverExecutionDisabledError extends Error {
  readonly code = "PRODUCTION_CUTOVER_EXECUTE_DISABLED";
}

export function assertResetCliExecutionAllowed(input: {
  execute: boolean;
  emulatorHost?: string;
}): void {
  assertProductionExecutionDisabled(
    input,
    RESET_CLI_PRODUCTION_EXECUTE_ENABLED,
    "本番reset executeは最終production execute解放PRまで無効です",
  );
}

export function assertRestoreCliExecutionAllowed(input: {
  execute: boolean;
  emulatorHost?: string;
}): void {
  assertProductionExecutionDisabled(
    input,
    RESTORE_CLI_PRODUCTION_EXECUTE_ENABLED,
    "本番restore executeは最終production execute解放PRまで無効です",
  );
}

export function assertResetServiceExecutionAllowed(emulatorHost?: string): void {
  assertProductionExecutionDisabled(
    { execute: true, emulatorHost },
    RESET_SERVICE_PRODUCTION_EXECUTE_ENABLED,
    "本番reset executeは最終production execute解放PRまで無効です",
  );
}

export function assertRestoreServiceExecutionAllowed(emulatorHost?: string): void {
  assertProductionExecutionDisabled(
    { execute: true, emulatorHost },
    RESTORE_SERVICE_PRODUCTION_EXECUTE_ENABLED,
    "本番restore executeは最終production execute解放PRまで無効です",
  );
}

export function assertFirestoreCommitAllowed(emulatorHost?: string): void {
  assertProductionExecutionDisabled(
    { execute: true, emulatorHost },
    FIRESTORE_REST_PRODUCTION_COMMIT_ENABLED,
    "cutover用Firestore REST clientの本番commitは最終production execute解放PRまで無効です",
  );
}

/** readinessは5境界の実行contractを呼び、production条件がすべて同期的に拒否されることを確認する。 */
export function probeProductionExecuteGatesClosed(): boolean {
  const probes = [
    () => assertResetCliExecutionAllowed({ execute: true }),
    () => assertRestoreCliExecutionAllowed({ execute: true }),
    () => assertResetServiceExecutionAllowed(),
    () => assertRestoreServiceExecutionAllowed(),
    () => assertFirestoreCommitAllowed(),
  ];
  return probes.every((probe) => {
    try {
      probe();
      return false;
    } catch (error) {
      return error instanceof ProductionCutoverExecutionDisabledError;
    }
  });
}

function assertProductionExecutionDisabled(
  input: { execute: boolean; emulatorHost?: string },
  productionEnabled: boolean,
  message: string,
): void {
  if (input.execute && !input.emulatorHost && !productionEnabled) {
    throw new ProductionCutoverExecutionDisabledError(message);
  }
}
