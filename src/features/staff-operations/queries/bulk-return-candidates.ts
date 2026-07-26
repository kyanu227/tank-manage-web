import {
  buildCustomerIdentityGroup,
  normalizeCustomerIdentityText,
  type CustomerIdentityGroup,
} from "@/lib/customer-identity-read";
import { tanksRepository } from "@/lib/firebase/repositories";
import { storedMarkerToReturnTag } from "@/lib/return-tag-rules";
import {
  coerceTankStatusCode,
  type TankStatusCode,
} from "@/lib/tank-action-status-codes";
import type {
  BulkReturnDatePool,
  BulkReturnGroupMeta,
  BulkTagType,
  BulkTankDoc,
} from "../types";

export type BulkTankWithTag = BulkTankDoc & {
  tag: BulkTagType;
};

export type BulkReturnCandidateGroups = {
  groupedTanks: Record<string, BulkTankWithTag[]>;
  groupMeta: Record<string, BulkReturnGroupMeta>;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const POOL_ORDER: Record<BulkReturnDatePool, number> = {
  today_lent: 0,
  past_lent: 1,
  unknown_lent: 2,
  long_term: 3,
};

function toMillis(value: unknown): number | null {
  if (!value) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "object" && "toMillis" in value && typeof value.toMillis === "function") {
    const millis = value.toMillis();
    return typeof millis === "number" && Number.isFinite(millis) ? millis : null;
  }
  return null;
}

function getJstDayStartMillis(millis: number): number {
  return Math.floor((millis + JST_OFFSET_MS) / DAY_MS) * DAY_MS - JST_OFFSET_MS;
}

function formatJstMonthDay(millis: number): string {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
  }).format(new Date(millis));
}

function resolveDatePool(
  status: TankStatusCode,
  updatedAt: unknown,
  nowMillis: number,
): BulkReturnDatePool {
  if (status === "unreturned") return "long_term";
  const updatedMillis = toMillis(updatedAt);
  if (updatedMillis == null) return "unknown_lent";

  const todayStart = getJstDayStartMillis(nowMillis);
  const tomorrowStart = todayStart + DAY_MS;
  if (updatedMillis >= todayStart && updatedMillis < tomorrowStart) return "today_lent";
  if (updatedMillis < todayStart) return "past_lent";
  return "unknown_lent";
}

function mergeSortMillis(
  pool: BulkReturnDatePool,
  current: number | null,
  next: number | null,
): number | null {
  if (next == null) return current;
  if (current == null) return next;
  if (pool === "past_lent") return Math.max(current, next);
  return Math.min(current, next);
}

function createGroupMeta(
  key: string,
  identity: CustomerIdentityGroup,
  pool: BulkReturnDatePool,
  sortMillis: number | null,
  nowMillis: number,
): BulkReturnGroupMeta {
  const baseMeta = {
    key,
    location: identity.displayName,
    ...(identity.customerId ? { customerId: identity.customerId } : {}),
    isLegacyCustomerIdentity: identity.isLegacy,
    pool,
    sortMillis,
  };

  if (pool === "today_lent") {
    return {
      ...baseMeta,
      poolLabel: "本日貸出",
      dateLabel: `${formatJstMonthDay(nowMillis)} 貸出分`,
    };
  }
  if (pool === "past_lent") {
    return {
      ...baseMeta,
      poolLabel: "前日以前",
      dateLabel: sortMillis != null ? `${formatJstMonthDay(sortMillis)} 以前` : "前日以前の貸出中",
    };
  }
  if (pool === "long_term") {
    return {
      ...baseMeta,
      poolLabel: "長期貸出",
      dateLabel: sortMillis != null ? `${formatJstMonthDay(sortMillis)} から未返却` : "未返却",
    };
  }
  return {
    ...baseMeta,
    poolLabel: "日付不明",
    dateLabel: "貸出日不明",
  };
}

function resolveBulkCustomerIdentity(tank: BulkTankDoc): CustomerIdentityGroup {
  return buildCustomerIdentityGroup({
    customerId: tank.customerId,
    customerName: tank.customerName,
    location: tank.location,
  });
}

function chooseStableDisplayName(current: string, next: string): string {
  const normalizedCurrent = normalizeCustomerIdentityText(current);
  const normalizedNext = normalizeCustomerIdentityText(next);
  if (!normalizedCurrent) return normalizedNext ?? "不明な顧客";
  if (!normalizedNext) return normalizedCurrent;
  if (normalizedCurrent === "不明な顧客") return normalizedNext;
  if (normalizedNext === "不明な顧客") return normalizedCurrent;
  return normalizedCurrent.localeCompare(normalizedNext) <= 0
    ? normalizedCurrent
    : normalizedNext;
}

function compareGroupKeys(
  a: string,
  b: string,
  groupMeta: Record<string, BulkReturnGroupMeta>,
): number {
  const metaA = groupMeta[a];
  const metaB = groupMeta[b];
  if (!metaA || !metaB) return a.localeCompare(b);
  const orderDiff = POOL_ORDER[metaA.pool] - POOL_ORDER[metaB.pool];
  if (orderDiff !== 0) return orderDiff;

  if (metaA.pool === "long_term") {
    const dateA = metaA.sortMillis ?? Number.MAX_SAFE_INTEGER;
    const dateB = metaB.sortMillis ?? Number.MAX_SAFE_INTEGER;
    if (dateA !== dateB) return dateA - dateB;
  }
  if (metaA.pool === "past_lent") {
    const dateA = metaA.sortMillis ?? 0;
    const dateB = metaB.sortMillis ?? 0;
    if (dateA !== dateB) return dateB - dateA;
  }
  return metaA.location.localeCompare(metaB.location);
}

async function getBulkReturnCandidateTanks(): Promise<BulkTankDoc[]> {
  const [codeMatchedTanks, allTanks] = await Promise.all([
    tanksRepository.getTanks({
      statusIn: ["lent", "unreturned"],
    }),
    tanksRepository.getTanks(),
  ]);
  const tanksById = new Map(
    codeMatchedTanks.map((tank) => [tank.id, tank as BulkTankDoc]),
  );

  allTanks.forEach((tank) => {
    const status = coerceTankStatusCode(tank.status);
    if (status !== "lent" && status !== "unreturned") return;
    if (!tanksById.has(tank.id)) tanksById.set(tank.id, tank as BulkTankDoc);
  });

  return Array.from(tanksById.values()).sort((a, b) => a.id.localeCompare(b.id));
}

export async function fetchBulkReturnCandidates(): Promise<BulkReturnCandidateGroups> {
  const tanks = await getBulkReturnCandidateTanks();
  const nowMillis = Date.now();
  return buildBulkReturnCandidateGroups(tanks, nowMillis);
}

export function buildBulkReturnCandidateGroups(
  tanks: readonly BulkTankDoc[],
  nowMillis: number,
): BulkReturnCandidateGroups {
  const groups: Record<string, BulkTankWithTag[]> = {};
  const metas: Record<string, BulkReturnGroupMeta> = {};

  tanks.forEach((tank) => {
    const identity = resolveBulkCustomerIdentity(tank);
    const status = requireBulkTankStatusCode(tank.status, tank.id);
    const pool = resolveDatePool(status, tank.updatedAt, nowMillis);
    const groupKey = `${pool}::${identity.key}`;
    const sortMillis = toMillis(tank.updatedAt);
    if (!groups[groupKey]) groups[groupKey] = [];
    const tag = storedMarkerToReturnTag(tank.logNote, { allowKeep: status === "lent" });
    groups[groupKey].push({ ...tank, tag });
    const currentSortMillis = metas[groupKey]?.sortMillis ?? null;
    const mergedSortMillis = mergeSortMillis(pool, currentSortMillis, sortMillis);
    const metaIdentity = metas[groupKey]
      ? {
          ...identity,
          displayName: chooseStableDisplayName(
            metas[groupKey].location,
            identity.displayName,
          ),
        }
      : identity;
    metas[groupKey] = createGroupMeta(
      groupKey,
      metaIdentity,
      pool,
      mergedSortMillis,
      nowMillis,
    );
  });
  Object.keys(groups).forEach((groupKey) => {
    groups[groupKey].sort((a, b) => a.id.localeCompare(b.id));
  });

  return {
    groupedTanks: groups,
    groupMeta: metas,
  };
}

export function getBulkReturnGroupKeys(
  groupedTanks: Record<string, BulkTankWithTag[]>,
  groupMeta: Record<string, BulkReturnGroupMeta>,
): string[] {
  return Object.keys(groupedTanks).sort((a, b) => compareGroupKeys(a, b, groupMeta));
}

function requireBulkTankStatusCode(status: string, tankId: string): TankStatusCode {
  const code = coerceTankStatusCode(status);
  if (!code) {
    throw new Error(`[${tankId}] status が不正です`);
  }
  return code;
}
