export type PortalReturnRawCycleMarkers = Readonly<{
  customerId: unknown;
  latestLogId: unknown;
}>;

export type PortalReturnCycleReadinessInput = Readonly<{
  id: string;
  customerId?: unknown;
  latestLogId?: unknown;
  rawCycleMarkers?: PortalReturnRawCycleMarkers;
}>;

export type PortalReturnCycleReadinessIssue = Readonly<{
  tankId: string;
  reason: "invalid_customer_id" | "invalid_latest_log_id" | "customer_id_mismatch";
}>;

export type PortalReturnReadyCycle<T extends PortalReturnCycleReadinessInput> = Readonly<{
  tank: T;
  customerId: string;
  latestLogId: string;
}>;

export type PortalReturnGroupReadiness<T extends PortalReturnCycleReadinessInput> =
  | Readonly<{
    ready: true;
    issues: readonly [];
    cycles: readonly PortalReturnReadyCycle<T>[];
  }>
  | Readonly<{
    ready: false;
    issues: readonly PortalReturnCycleReadinessIssue[];
  }>;

/** repository 由来なら Firestore raw 値を、既存の直接入力なら正規化済み field を読む。 */
export function getPortalReturnObservedCycleMarkers(
  tank: PortalReturnCycleReadinessInput,
): PortalReturnRawCycleMarkers {
  return tank.rawCycleMarkers ?? {
    customerId: tank.customerId,
    latestLogId: tank.latestLogId,
  };
}

/**
 * 返却申請対象を全件検査し、1本でも不成立なら ready cycle を返さない。
 * trim は空判定にだけ使い、marker の保存値は変更しない。
 */
export function getPortalReturnGroupReadiness<
  T extends PortalReturnCycleReadinessInput,
>(
  tanks: readonly T[],
  identityCustomerId: string,
): PortalReturnGroupReadiness<T> {
  const issues: PortalReturnCycleReadinessIssue[] = [];
  const cycles: PortalReturnReadyCycle<T>[] = [];

  tanks.forEach((tank) => {
    const observed = getPortalReturnObservedCycleMarkers(tank);
    const customerIdValid = isNonEmptyString(observed.customerId);
    const latestLogIdValid = isNonEmptyString(observed.latestLogId);

    if (!customerIdValid) {
      issues.push({ tankId: tank.id, reason: "invalid_customer_id" });
    }
    if (!latestLogIdValid) {
      issues.push({ tankId: tank.id, reason: "invalid_latest_log_id" });
    }
    if (customerIdValid && observed.customerId !== identityCustomerId) {
      issues.push({ tankId: tank.id, reason: "customer_id_mismatch" });
    }

    if (
      customerIdValid
      && latestLogIdValid
      && observed.customerId === identityCustomerId
    ) {
      cycles.push({
        tank,
        customerId: observed.customerId,
        latestLogId: observed.latestLogId,
      });
    }
  });

  if (issues.length > 0) {
    return { ready: false, issues };
  }

  return { ready: true, issues: [], cycles };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}
