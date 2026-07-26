"use client";

import { useCallback, useMemo, useState } from "react";
import { requireStaffIdentity } from "@/hooks/useStaffSession";
import { updateTankReturnTagMarker } from "@/lib/firebase/tank-tag-service";
import { applyBulkTankOperations } from "@/lib/tank-operation";
import { coerceTankStatusCode, type TankStatusCode } from "@/lib/tank-action-status-codes";
import { RETURN_TAG, resolveReturnActionCode, type ReturnTag } from "@/lib/tank-rules";
import {
  fetchBulkReturnCandidates,
  getBulkReturnGroupKeys,
  type BulkTankWithTag,
} from "../queries/bulk-return-candidates";
import type { BulkReturnGroupMeta, BulkTagType } from "../types";

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
      const result = await fetchBulkReturnCandidates();
      setGroupedTanks(result.groupedTanks);
      setGroupMeta(result.groupMeta);
      const newExpanded: Record<string, boolean> = {};
      Object.keys(result.groupedTanks).forEach(groupKey => newExpanded[groupKey] = true);
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
    if (newTag === RETURN_TAG.KEEP && coerceTankStatusCode(targetTank.status) !== "lent") {
      alert("持ち越しは貸出中のタンクのみ選択できます。");
      return;
    }
    setGroupedTanks(prev => {
      const g = { ...prev };
      g[groupKey] = g[groupKey].map(t => (t.id === tankId ? { ...t, tag: newTag } : t));
      return g;
    });
    try {
      await updateTankReturnTagMarker(tankId, newTag);
    } catch (e) {
      console.error("Failed to update tag", e);
      fetchBulkTanks();
    }
  }, [fetchBulkTanks, groupedTanks]);

  const handleBulkReturnForGroup = useCallback(async (groupKey: string) => {
    const tanksToReturn = groupedTanks[groupKey];
    if (!tanksToReturn || tanksToReturn.length === 0) return;
    const meta = groupMeta[groupKey];
    const loc = meta?.location ?? tanksToReturn[0]?.customerName ?? tanksToReturn[0]?.location ?? "不明";
    const groupLabel = meta ? `${loc}（${meta.poolLabel}）` : loc;
    const invalidKeepTanks = tanksToReturn.filter((tank) => tank.tag === RETURN_TAG.KEEP && coerceTankStatusCode(tank.status) !== "lent");
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
      const context = {
        actor: requireStaffIdentity(),
        source: "bulk_return" as const,
        workflow: "tank_operation" as const,
      };

      await applyBulkTankOperations(
        tanksToReturn.map((tank) => {
          const tag = (tank.tag || RETURN_TAG.NORMAL) as ReturnTag;
          const isKeep = tag === RETURN_TAG.KEEP;
          return {
            tankId: tank.id,
            transitionAction: resolveReturnActionCode(tag, requireBulkTankStatusCode(tank.status, tank.id)),
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
    } catch (e: unknown) {
      alert("エラー: " + errorMessage(e));
    } finally {
      setReturning(prev => ({ ...prev, [groupKey]: false }));
    }
  }, [fetchBulkTanks, groupMeta, groupedTanks]);

  const groupKeys = useMemo(
    () => getBulkReturnGroupKeys(groupedTanks, groupMeta),
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

function requireBulkTankStatusCode(status: string, tankId: string): TankStatusCode {
  const code = coerceTankStatusCode(status);
  if (!code) {
    throw new Error(`[${tankId}] status が不正です`);
  }
  return code;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
