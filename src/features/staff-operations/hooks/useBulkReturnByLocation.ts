"use client";

import { useCallback, useMemo, useState } from "react";
import { requireStaffIdentity } from "@/hooks/useStaffSession";
import { updateLogNote } from "@/lib/firebase/tank-tag-service";
import { tanksRepository } from "@/lib/firebase/repositories";
import { applyBulkTankOperations } from "@/lib/tank-operation";
import { RETURN_TAG, STATUS, resolveReturnAction, type ReturnTag } from "@/lib/tank-rules";
import type { BulkTagType, BulkTankDoc } from "../types";

type BulkTankWithTag = BulkTankDoc & { tag: BulkTagType };

export interface UseBulkReturnByLocationResult {
  bulkLoading: boolean;
  groupedTanks: Record<string, BulkTankWithTag[]>;
  expanded: Record<string, boolean>;
  returning: Record<string, boolean>;
  locationKeys: string[];
  fetchBulkTanks: () => Promise<void>;
  toggleExpand: (loc: string) => void;
  updateTag: (loc: string, tankId: string, newTag: BulkTagType) => Promise<void>;
  handleBulkReturnForLocation: (loc: string) => Promise<void>;
}

export function useBulkReturnByLocation(): UseBulkReturnByLocationResult {
  const [bulkLoading, setBulkLoading] = useState(true);
  const [groupedTanks, setGroupedTanks] = useState<Record<string, BulkTankWithTag[]>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [returning, setReturning] = useState<Record<string, boolean>>({});

  const fetchBulkTanks = useCallback(async () => {
    setBulkLoading(true);
    try {
      const tanks = await tanksRepository.getTanks({
        statusIn: [STATUS.LENT, STATUS.UNRETURNED],
      });
      const groups: Record<string, BulkTankWithTag[]> = {};
      tanks.forEach((tank) => {
        const loc = tank.location || "不明";
        if (!groups[loc]) groups[loc] = [];
        let tag: BulkTagType = "normal";
        if (tank.logNote === "[TAG:unused]") tag = "unused";
        if (tank.logNote === "[TAG:uncharged]") tag = "uncharged";
        if (tank.status === STATUS.LENT && tank.logNote === "[TAG:keep]") tag = "keep";
        groups[loc].push({ ...tank, tag } as unknown as BulkTankWithTag);
      });
      Object.keys(groups).forEach(loc => {
        groups[loc].sort((a, b) => a.id.localeCompare(b.id));
      });
      setGroupedTanks(groups);
      const newExpanded: Record<string, boolean> = {};
      Object.keys(groups).forEach(loc => newExpanded[loc] = true);
      setExpanded(newExpanded);
    } catch (e) {
      console.error(e);
    } finally {
      setBulkLoading(false);
    }
  }, []);

  const toggleExpand = useCallback((loc: string) => {
    setExpanded(prev => ({ ...prev, [loc]: !prev[loc] }));
  }, []);

  const updateTag = useCallback(async (loc: string, tankId: string, newTag: BulkTagType) => {
    const targetTank = groupedTanks[loc]?.find((tank) => tank.id === tankId);
    if (!targetTank) return;
    if (newTag === RETURN_TAG.KEEP && targetTank.status !== STATUS.LENT) {
      alert("持ち越しは貸出中のタンクのみ選択できます。");
      return;
    }
    setGroupedTanks(prev => {
      const g = { ...prev };
      g[loc] = g[loc].map(t => (t.id === tankId ? { ...t, tag: newTag } : t));
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

  const handleBulkReturnForLocation = useCallback(async (loc: string) => {
    const tanksToReturn = groupedTanks[loc];
    if (!tanksToReturn || tanksToReturn.length === 0) return;
    const invalidKeepTanks = tanksToReturn.filter((tank) => tank.tag === RETURN_TAG.KEEP && tank.status !== STATUS.LENT);
    if (invalidKeepTanks.length > 0) {
      alert("持ち越しは貸出中のタンクのみ処理できます。未返却タンクの持ち越しを外してください。");
      return;
    }
    const keepCount = tanksToReturn.filter((tank) => tank.tag === RETURN_TAG.KEEP).length;
    const returnCount = tanksToReturn.length - keepCount;
    const confirmMessage = keepCount > 0
      ? `${loc} のタンクを処理しますか？\n返却: ${returnCount}本 / 持ち越し: ${keepCount}本`
      : `${loc} のタンク全 ${tanksToReturn.length} 本を一括返却しますか？\n(タグ付けに応じて処理されます)`;
    if (!confirm(confirmMessage)) return;

    setReturning(prev => ({ ...prev, [loc]: true }));
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
        ? `${loc} の処理が完了しました。\n返却: ${returnCount}本 / 持ち越し: ${keepCount}本`
        : `${loc} の一括返却が完了しました。`;
      alert(completeMessage);
      fetchBulkTanks();
    } catch (e: any) {
      alert("エラー: " + e.message);
    } finally {
      setReturning(prev => ({ ...prev, [loc]: false }));
    }
  }, [fetchBulkTanks, groupedTanks]);

  const locationKeys = useMemo(() => Object.keys(groupedTanks).sort(), [groupedTanks]);

  return {
    bulkLoading,
    groupedTanks,
    expanded,
    returning,
    locationKeys,
    fetchBulkTanks,
    toggleExpand,
    updateTag,
    handleBulkReturnForLocation,
  };
}
