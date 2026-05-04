"use client";

import { useCallback, useState } from "react";
import { doc, serverTimestamp } from "firebase/firestore";
import { requireStaffIdentity } from "@/hooks/useStaffSession";
import { db } from "@/lib/firebase/config";
import { tanksRepository, transactionsRepository } from "@/lib/firebase/repositories";
import { applyBulkTankOperations } from "@/lib/tank-operation";
import {
  ACTION,
  RETURN_TAG,
  resolveReturnAction,
  type ReturnTag,
  type TankAction,
} from "@/lib/tank-rules";
import type { Condition, PendingReturn, ReturnGroup, ReturnTagSelectionMap } from "../types";

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
    const selectedItems = selectedReturnGroup.items.filter((i) => returnTagSelections[i.id]?.selected);
    if (selectedItems.length === 0) {
      alert("処理するタンクを選択してください");
      return;
    }
    setReturnTagProcessingSubmitting(true);
    try {
      const actor = requireStaffIdentity();
      const context = {
        actor,
        customer: {
          customerId: selectedReturnGroup.customerId,
          customerName: selectedReturnGroup.customerName,
        },
      };

      // 処理直前に tanks/{tankId} を再取得し、現在の status を使う。
      // 処理待ちの間にタンク状態が変わっている可能性があるため、STATUS.LENT 固定だと
      // validateTransition や logAction の決定が古い前提で行われてしまう。
      // 存在しないタンクIDはここで弾く（幽霊タンク生成を防ぐ最終防衛ライン）。
      const selectedData = await Promise.all(selectedItems.map(async (item) => {
        const appData = returnTagSelections[item.id];
        const condition = appData?.condition ?? item.condition;
        const tag: ReturnTag =
          condition === "unused" ? RETURN_TAG.UNUSED
            : condition === "uncharged" ? RETURN_TAG.UNCHARGED
              : RETURN_TAG.NORMAL;
        const note = `[返却タグ処理] 顧客: ${selectedReturnGroup.customerName} (タグ:${condition})`;
        const tank = await tanksRepository.getTank(item.tankId);
        if (!tank) {
          throw new Error(`[${item.tankId}] タンクが存在しません`);
        }
        const currentStatus = tank.status ?? "";
        const transitionAction: TankAction = condition === "keep"
          ? ACTION.CARRY_OVER
          : resolveReturnAction(tag, currentStatus);
        const location = condition === "keep"
          ? tank.location || selectedReturnGroup.customerName
          : "倉庫";
        return { item, condition: condition as Condition, note, currentStatus, transitionAction, location };
      }));

      await applyBulkTankOperations(
        selectedData.map(({ item, note, currentStatus, transitionAction, location }) => ({
          tankId: item.tankId,
          transitionAction,
          currentStatus,
          context,
          location,
          tankNote: note,
          logNote: note,
        })),
        (batch) => {
          selectedData.forEach(({ item, condition }) => {
            batch.update(doc(db, "transactions", item.id), {
              status: "completed",
              finalCondition: condition,
              fulfilledAt: serverTimestamp(),
              fulfilledBy: actor.staffName,
              fulfilledByStaffId: actor.staffId,
              fulfilledByStaffName: actor.staffName,
              ...(actor.staffEmail ? { fulfilledByStaffEmail: actor.staffEmail } : {}),
            });
          });
        }
      );

      alert(`${selectedItems.length}件の返却タグを処理しました`);
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
