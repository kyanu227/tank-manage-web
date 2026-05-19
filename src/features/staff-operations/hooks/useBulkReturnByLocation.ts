"use client";

import { useCallback, useMemo, useState } from "react";
import { requireStaffIdentity } from "@/hooks/useStaffSession";
import { updateLogNote } from "@/lib/firebase/tank-tag-service";
import { tanksRepository } from "@/lib/firebase/repositories";
import { applyBulkTankOperations } from "@/lib/tank-operation";
import { RETURN_TAG, STATUS, resolveReturnAction, type ReturnTag } from "@/lib/tank-rules";
import type { BulkReturnDatePool, BulkReturnGroupMeta, BulkTagType, BulkTankDoc } from "../types";

type BulkTankWithTag = BulkTankDoc & { tag: BulkTagType };

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

function resolveDatePool(status: string, updatedAt: unknown, nowMillis: number): BulkReturnDatePool {
  if (status === STATUS.UNRETURNED) return "long_term";
  const updatedMillis = toMillis(updatedAt);
  if (updatedMillis == null) return "unknown_lent";

  const todayStart = getJstDayStartMillis(nowMillis);
  const tomorrowStart = todayStart + DAY_MS;
  if (updatedMillis >= todayStart && updatedMillis < tomorrowStart) return "today_lent";
  if (updatedMillis < todayStart) return "past_lent";
  return "unknown_lent";
}

function mergeSortMillis(pool: BulkReturnDatePool, current: number | null, next: number | null): number | null {
  if (next == null) return current;
  if (current == null) return next;
  if (pool === "past_lent") return Math.max(current, next);
  return Math.min(current, next);
}

function createGroupMeta(
  key: string,
  location: string,
  pool: BulkReturnDatePool,
  sortMillis: number | null,
  nowMillis: number
): BulkReturnGroupMeta {
  if (pool === "today_lent") {
    return {
      key,
      location,
      pool,
      poolLabel: "本日貸出",
      dateLabel: `${formatJstMonthDay(nowMillis)} 貸出分`,
      sortMillis,
    };
  }
  if (pool === "past_lent") {
    return {
      key,
      location,
      pool,
      poolLabel: "前日以前",
      dateLabel: sortMillis != null ? `${formatJstMonthDay(sortMillis)} 以前` : "前日以前の貸出中",
      sortMillis,
    };
  }
  if (pool === "long_term") {
    return {
      key,
      location,
      pool,
      poolLabel: "長期貸出",
      dateLabel: sortMillis != null ? `${formatJstMonthDay(sortMillis)} から未返却` : "未返却",
      sortMillis,
    };
  }
  return {
    key,
    location,
    pool,
    poolLabel: "日付不明",
    dateLabel: "貸出日不明",
    sortMillis,
  };
}

function compareGroupKeys(a: string, b: string, groupMeta: Record<string, BulkReturnGroupMeta>): number {
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

export interface UseBulkReturnByLocationResult {
  bulkLoading: boolean;
  groupedTanks: Record<string, BulkTankWithTag[]>;
  groupMeta: Record<string, BulkReturnGroupMeta>;
  expanded: Record<string, boolean>;
  returning: Record<string, boolean>;
  groupKeys: string[];
  fetchBulkTanks: () => Promise<void>;
  toggleExpand: (groupKey: string) => void;
  updateTag: (groupKey: string, tankId: string, newTag: BulkTagType) => Promise<void>;
  handleBulkReturnForGroup: (groupKey: string) => Promise<void>;
}

export function useBulkReturnByLocation(): UseBulkReturnByLocationResult {
  const [bulkLoading, setBulkLoading] = useState(true);
  const [groupedTanks, setGroupedTanks] = useState<Record<string, BulkTankWithTag[]>>({});
  const [groupMeta, setGroupMeta] = useState<Record<string, BulkReturnGroupMeta>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [returning, setReturning] = useState<Record<string, boolean>>({});

  const fetchBulkTanks = useCallback(async () => {
    setBulkLoading(true);
    try {
      const tanks = await tanksRepository.getTanks({
        statusIn: [STATUS.LENT, STATUS.UNRETURNED],
      });
      const groups: Record<string, BulkTankWithTag[]> = {};
      const metas: Record<string, BulkReturnGroupMeta> = {};
      const nowMillis = Date.now();
      tanks.forEach((tank) => {
        const loc = tank.location || "不明";
        const pool = resolveDatePool(tank.status, tank.updatedAt, nowMillis);
        const groupKey = `${pool}::${loc}`;
        const sortMillis = toMillis(tank.updatedAt);
        if (!groups[groupKey]) groups[groupKey] = [];
        let tag: BulkTagType = "normal";
        if (tank.logNote === "[TAG:unused]") tag = "unused";
        if (tank.logNote === "[TAG:uncharged]") tag = "uncharged";
        if (tank.status === STATUS.LENT && tank.logNote === "[TAG:keep]") tag = "keep";
        groups[groupKey].push({ ...tank, tag } as unknown as BulkTankWithTag);
        const currentSortMillis = metas[groupKey]?.sortMillis ?? null;
        const mergedSortMillis = mergeSortMillis(pool, currentSortMillis, sortMillis);
        metas[groupKey] = createGroupMeta(groupKey, loc, pool, mergedSortMillis, nowMillis);
      });
      Object.keys(groups).forEach(groupKey => {
        groups[groupKey].sort((a, b) => a.id.localeCompare(b.id));
      });
      setGroupedTanks(groups);
      setGroupMeta(metas);
      const newExpanded: Record<string, boolean> = {};
      Object.keys(groups).forEach(groupKey => newExpanded[groupKey] = true);
      setExpanded(newExpanded);
    } catch (e) {
      console.error(e);
    } finally {
      setBulkLoading(false);
    }
  }, []);

  const toggleExpand = useCallback((groupKey: string) => {
    setExpanded(prev => ({ ...prev, [groupKey]: !prev[groupKey] }));
  }, []);

  const updateTag = useCallback(async (groupKey: string, tankId: string, newTag: BulkTagType) => {
    const targetTank = groupedTanks[groupKey]?.find((tank) => tank.id === tankId);
    if (!targetTank) return;
    if (newTag === RETURN_TAG.KEEP && targetTank.status !== STATUS.LENT) {
      alert("持ち越しは貸出中のタンクのみ選択できます。");
      return;
    }
    setGroupedTanks(prev => {
      const g = { ...prev };
      g[groupKey] = g[groupKey].map(t => (t.id === tankId ? { ...t, tag: newTag } : t));
      return g;
    });
    try {
      let logNote = "";
      if (newTag === RETURN_TAG.UNUSED) logNote = "[TAG:unused]";
      if (newTag === RETURN_TAG.UNCHARGED) logNote = "[TAG:uncharged]";
      if (newTag === RETURN_TAG.KEEP) {
        await updateLogNote(tankId, "");
        return;
      }
      await updateLogNote(tankId, logNote);
    } catch (e) {
      console.error("Failed to update tag", e);
      fetchBulkTanks();
    }
  }, [fetchBulkTanks, groupedTanks]);

  const handleBulkReturnForGroup = useCallback(async (groupKey: string) => {
    const tanksToReturn = groupedTanks[groupKey];
    if (!tanksToReturn || tanksToReturn.length === 0) return;
    const meta = groupMeta[groupKey];
    const loc = meta?.location ?? tanksToReturn[0]?.location ?? "不明";
    const groupLabel = meta ? `${loc}（${meta.poolLabel}）` : loc;
    const invalidKeepTanks = tanksToReturn.filter((tank) => tank.tag === RETURN_TAG.KEEP && tank.status !== STATUS.LENT);
    if (invalidKeepTanks.length > 0) {
      alert("持ち越しは貸出中のタンクのみ処理できます。未返却タンクの持ち越しを外してください。");
      return;
    }
    const keepCount = tanksToReturn.filter((tank) => tank.tag === RETURN_TAG.KEEP).length;
    const returnCount = tanksToReturn.length - keepCount;
    const confirmMessage = keepCount > 0
      ? `${groupLabel} のタンクを処理しますか？\n返却: ${returnCount}本 / 持ち越し: ${keepCount}本`
      : `${groupLabel} のタンク全 ${tanksToReturn.length} 本を一括返却しますか？\n(タグ付けに応じて処理されます)`;
    if (!confirm(confirmMessage)) return;

    setReturning(prev => ({ ...prev, [groupKey]: true }));
    try {
      const context = { actor: requireStaffIdentity() };

      await applyBulkTankOperations(
        tanksToReturn.map((tank) => {
          const tag = (tank.tag || RETURN_TAG.NORMAL) as ReturnTag;
          const isKeep = tag === RETURN_TAG.KEEP;
          return {
            tankId: tank.id,
            transitionAction: resolveReturnAction(tag, tank.status),
            currentStatus: tank.status,
            context,
            location: isKeep ? tank.location || loc || "不明" : "倉庫",
            tankNote: "",
            logNote: isKeep ? "持ち越し" : "",
          };
        })
      );

      const completeMessage = keepCount > 0
        ? `${groupLabel} の処理が完了しました。\n返却: ${returnCount}本 / 持ち越し: ${keepCount}本`
        : `${groupLabel} の一括返却が完了しました。`;
      alert(completeMessage);
      fetchBulkTanks();
    } catch (e: any) {
      alert("エラー: " + e.message);
    } finally {
      setReturning(prev => ({ ...prev, [groupKey]: false }));
    }
  }, [fetchBulkTanks, groupMeta, groupedTanks]);

  const groupKeys = useMemo(
    () => Object.keys(groupedTanks).sort((a, b) => compareGroupKeys(a, b, groupMeta)),
    [groupMeta, groupedTanks]
  );

  return {
    bulkLoading,
    groupedTanks,
    groupMeta,
    expanded,
    returning,
    groupKeys,
    fetchBulkTanks,
    toggleExpand,
    updateTag,
    handleBulkReturnForGroup,
  };
}
