"use client";

import { useCallback, useState } from "react";
import { requireStaffIdentity } from "@/hooks/useStaffSession";
import { processReturnTags as processReturnTagsTransaction } from "@/lib/firebase/return-tag-processing-service";
import { transactionsRepository } from "@/lib/firebase/repositories";
import type { PendingReturn, ReturnGroup, ReturnTagSelectionMap } from "../types";

interface UseReturnTagProcessingParams {
  fetchBulkTanks: () => Promise<void>;
}

export interface UseReturnTagProcessingResult {
  pendingReturnTagsLoading: boolean;
  returnGroups: ReturnGroup[];
  selectedReturnGroup: ReturnGroup | null;
  setSelectedReturnGroup: (group: ReturnGroup | null) => void;
  returnTagSelections: ReturnTagSelectionMap;
  setReturnTagSelections: React.Dispatch<React.SetStateAction<ReturnTagSelectionMap>>;
  returnTagProcessingSubmitting: boolean;
  fetchPendingReturnTags: () => Promise<void>;
  openReturnTagGroup: (group: ReturnGroup) => void;
  processReturnTags: () => Promise<void>;
}

export function useReturnTagProcessing({
  fetchBulkTanks,
}: UseReturnTagProcessingParams): UseReturnTagProcessingResult {
  const [pendingReturnTagsLoading, setPendingReturnTagsLoading] = useState(true);
  const [returnGroups, setReturnGroups] = useState<ReturnGroup[]>([]);
  const [selectedReturnGroup, setSelectedReturnGroup] = useState<ReturnGroup | null>(null);
  const [returnTagSelections, setReturnTagSelections] = useState<ReturnTagSelectionMap>({});
  const [returnTagProcessingSubmitting, setReturnTagProcessingSubmitting] = useState(false);

  const fetchPendingReturnTags = useCallback(async () => {
    setPendingReturnTagsLoading(true);
    try {
      const docs = await transactionsRepository.getPendingReturnTags();
      const items = docs as unknown as PendingReturn[];
      const groupMap = new Map<string, ReturnGroup>();
      items.forEach((item) => {
        if (!groupMap.has(item.customerId)) groupMap.set(item.customerId, { customerId: item.customerId, customerName: item.customerName, items: [] });
        groupMap.get(item.customerId)!.items.push(item);
      });
      const groups = Array.from(groupMap.values());
      groups.forEach((g) => g.items.sort((a, b) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0)));
      groups.sort((a, b) => (b.items[0]?.createdAt?.toMillis() || 0) - (a.items[0]?.createdAt?.toMillis() || 0));
      setReturnGroups(groups);
    } catch (e) {
      console.error(e);
    } finally {
      setPendingReturnTagsLoading(false);
    }
  }, []);

  const openReturnTagGroup = useCallback((group: ReturnGroup) => {
    setSelectedReturnGroup(group);
    const init: ReturnTagSelectionMap = {};
    group.items.forEach((item) => {
      init[item.id] = { selected: false, condition: item.condition };
    });
    setReturnTagSelections(init);
  }, []);

  const processReturnTags = useCallback(async () => {
    if (!selectedReturnGroup) return;
    const selectedCount = selectedReturnGroup.items.filter((i) => returnTagSelections[i.id]?.selected).length;
    if (selectedCount === 0) {
      alert("処理するタンクを選択してください");
      return;
    }
    setReturnTagProcessingSubmitting(true);
    try {
      const actor = requireStaffIdentity();
      const { processedCount } = await processReturnTagsTransaction({
        group: selectedReturnGroup,
        selections: returnTagSelections,
        actor,
      });

      alert(`${processedCount}件の返却タグを処理しました`);
      setSelectedReturnGroup(null);
      fetchPendingReturnTags();
      fetchBulkTanks();
    } catch (e: any) {
      alert("エラー: " + e.message);
    } finally {
      setReturnTagProcessingSubmitting(false);
    }
  }, [fetchBulkTanks, fetchPendingReturnTags, returnTagSelections, selectedReturnGroup]);

  return {
    pendingReturnTagsLoading,
    returnGroups,
    selectedReturnGroup,
    setSelectedReturnGroup,
    returnTagSelections,
    setReturnTagSelections,
    returnTagProcessingSubmitting,
    fetchPendingReturnTags,
    openReturnTagGroup,
    processReturnTags,
  };
}
