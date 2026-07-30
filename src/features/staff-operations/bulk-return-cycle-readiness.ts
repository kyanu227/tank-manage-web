export type BulkReturnCycleReadinessInput = Readonly<{
  id: string;
  customerId?: unknown;
  latestLogId?: unknown;
}>;

export type BulkReturnCycleReadinessIssue = Readonly<{
  tankId: string;
  field: "customerId" | "latestLogId";
}>;

export type BulkReturnGroupReadiness = Readonly<{
  ready: boolean;
  issues: readonly BulkReturnCycleReadinessIssue[];
}>;

/**
 * A1 bulk workflow の ExpectedTankCycle DTO 検査条件と parity を維持する。
 * trim は空判定だけに使い、入力値や入力順は変更しない。
 */
export function getBulkReturnGroupReadiness(
  tanks: readonly BulkReturnCycleReadinessInput[],
): BulkReturnGroupReadiness {
  const issues: BulkReturnCycleReadinessIssue[] = [];

  tanks.forEach((tank) => {
    if (!isNonEmptyString(tank.customerId)) {
      issues.push({ tankId: tank.id, field: "customerId" });
    }
    if (!isNonEmptyString(tank.latestLogId)) {
      issues.push({ tankId: tank.id, field: "latestLogId" });
    }
  });

  return {
    ready: issues.length === 0,
    issues,
  };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}
