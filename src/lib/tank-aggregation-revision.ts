export type TankAggregationRevisions = {
  /** raw logs、pending、印刷停止状態などを画面が再取得するためのrevision。 */
  tankDataRevision: number;
  /** 正式集計対象が変わった場合だけ増えるrevision。 */
  officialAggregationRevision: number;
};

export type TankAggregationRevisionChange = {
  dataChanged: boolean;
  officialChanged: boolean;
};

export function normalizeTankAggregationRevisions(
  value: unknown,
): TankAggregationRevisions {
  const record = objectRecord(value);
  return {
    tankDataRevision: normalizeAggregationRevision(record?.tankDataRevision),
    officialAggregationRevision: normalizeAggregationRevision(
      record?.officialAggregationRevision,
    ),
  };
}

export function nextTankAggregationRevisions(
  current: TankAggregationRevisions,
  change: TankAggregationRevisionChange,
): TankAggregationRevisions {
  const next = {
    tankDataRevision: incrementRevision(
      current.tankDataRevision,
      change.dataChanged,
    ),
    officialAggregationRevision: incrementRevision(
      current.officialAggregationRevision,
      change.officialChanged,
    ),
  };
  if (next.officialAggregationRevision > next.tankDataRevision) {
    throw new Error("正式集計revisionがデータrevisionを超えています。");
  }
  return next;
}

export function normalizeAggregationRevision(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : 0;
}

export function isOfficialAggregationSnapshotStale(
  savedOfficialRevision: unknown,
  currentOfficialRevision: unknown,
): boolean {
  return normalizeAggregationRevision(savedOfficialRevision)
    < normalizeAggregationRevision(currentOfficialRevision);
}

function incrementRevision(revision: number, shouldIncrement: boolean): number {
  const current = normalizeAggregationRevision(revision);
  if (!shouldIncrement) return current;
  const next = current + 1;
  if (!Number.isSafeInteger(next)) {
    throw new Error("集計revisionの上限に達しています。");
  }
  return next;
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
