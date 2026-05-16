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
        if (tank.logNote === "[TAG:keep]") tag = "keep";
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
    const currentTag = groupedTanks[loc]?.find((tank) => tank.id === tankId)?.tag;
    setGroupedTanks(prev => {
      const g = { ...prev };
      g[loc] = g[loc].map(t => (t.id === tankId ? { ...t, tag: newTag } : t));
      return g;
    });
    if (newTag === "keep" || currentTag === "keep") {
      return;
    }
    try {
      let logNote = "";
      if (newTag === "unused") logNote = "[TAG:unused]";
      if (newTag === "uncharged") logNote = "[TAG:uncharged]";
      await updateLogNote(tankId, logNote);
    } catch (e) {
      console.error("Failed to update tag", e);
      fetchBulkTanks();
    }
  }, [fetchBulkTanks, groupedTanks]);

  const handleBulkReturnForLocation = useCallback(async (loc: string) => {
    const tanksToReturn = groupedTanks[loc];
    if (!tanksToReturn || tanksToReturn.length === 0) return;
    if (tanksToReturn.some((tank) => tank.tag === "keep")) {
      alert("持ち越しを含む一括返却はまだ実行できません。持ち越し対象を外してから処理してください。");
      return;
    }
    if (!confirm(`${loc} の貸出中タンク全 ${tanksToReturn.length} 本を一括返却しますか？\n(タグ付けに応じて処理されます)`)) return;

    setReturning(prev => ({ ...prev, [loc]: true }));
    try {
      const context = { actor: requireStaffIdentity() };

      await applyBulkTankOperations(
        tanksToReturn.map((tank) => {
          const tag = (tank.tag || RETURN_TAG.NORMAL) as ReturnTag;
          return {
            tankId: tank.id,
            transitionAction: resolveReturnAction(tag, tank.status),
            currentStatus: tank.status,
            context,
            location: "倉庫",
          };
        })
      );

      alert(`${loc} の一括返却が完了しました。`);
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
