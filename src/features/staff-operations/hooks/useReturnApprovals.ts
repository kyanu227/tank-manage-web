"use client";

import { useCallback, useState } from "react";
import { collection, doc, getDoc, getDocs, query, serverTimestamp, where } from "firebase/firestore";
import { getStaffName } from "@/hooks/useStaffSession";
import { db } from "@/lib/firebase/config";
import { applyBulkTankOperations } from "@/lib/tank-operation";
import {
  RETURN_TAG,
  resolveReturnAction,
  type ReturnTag,
} from "@/lib/tank-rules";
import type { ApprovalMap, Condition, PendingReturn, ReturnGroup } from "../types";

interface UseReturnApprovalsParams {
  fetchBulkTanks: () => Promise<void>;
}

export interface UseReturnApprovalsResult {
  approvalsLoading: boolean;
  returnGroups: ReturnGroup[];
  selectedReturnGroup: ReturnGroup | null;
  setSelectedReturnGroup: (group: ReturnGroup | null) => void;
  approvals: ApprovalMap;
  setApprovals: React.Dispatch<React.SetStateAction<ApprovalMap>>;
  approvalSubmitting: boolean;
  fetchApprovals: () => Promise<void>;
  openReturnGroup: (group: ReturnGroup) => void;
  fulfillReturns: () => Promise<void>;
}

export function useReturnApprovals({
  fetchBulkTanks,
}: UseReturnApprovalsParams): UseReturnApprovalsResult {
  const [approvalsLoading, setApprovalsLoading] = useState(true);
  const [returnGroups, setReturnGroups] = useState<ReturnGroup[]>([]);
  const [selectedReturnGroup, setSelectedReturnGroup] = useState<ReturnGroup | null>(null);
  const [approvals, setApprovals] = useState<ApprovalMap>({});
  const [approvalSubmitting, setApprovalSubmitting] = useState(false);

  const fetchApprovals = useCallback(async () => {
    setApprovalsLoading(true);
    try {
      const q = query(collection(db, "transactions"), where("type", "==", "return"), where("status", "==", "pending_approval"));
      const snap = await getDocs(q);
      const items: PendingReturn[] = [];
      snap.forEach((d) => items.push({ id: d.id, ...d.data() } as PendingReturn));
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
      setApprovalsLoading(false);
    }
  }, []);

  const openReturnGroup = useCallback((group: ReturnGroup) => {
    setSelectedReturnGroup(group);
    const init: ApprovalMap = {};
    group.items.forEach((item) => {
      init[item.id] = { approved: false, condition: item.condition };
    });
    setApprovals(init);
  }, []);

  const fulfillReturns = useCallback(async () => {
    if (!selectedReturnGroup) return;
    const approved = selectedReturnGroup.items.filter((i) => approvals[i.id]?.approved);
    if (approved.length === 0) {
      alert("承認するタンクを選択してください");
      return;
    }
    setApprovalSubmitting(true);
    try {
      const staffName = getStaffName();

      // 承認直前に tanks/{tankId} を再取得し、現在の status を使う。
      // 承認待ちの間にタンク状態が変わっている可能性があるため、STATUS.LENT 固定だと
      // validateTransition や logAction の決定が古い前提で行われてしまう。
      // 存在しないタンクIDはここで弾く（幽霊タンク生成を防ぐ最終防衛ライン）。
      const approvedData = await Promise.all(approved.map(async (item) => {
        const appData = approvals[item.id];
        const tag: ReturnTag =
          appData.condition === "unused" ? RETURN_TAG.UNUSED
            : appData.condition === "uncharged" ? RETURN_TAG.DEFECT
              : RETURN_TAG.NORMAL;
        const note = `[承認] 顧客: ${selectedReturnGroup.customerName} (タグ:${appData.condition})`;
        const tankSnap = await getDoc(doc(db, "tanks", item.tankId));
        if (!tankSnap.exists()) {
          throw new Error(`[${item.tankId}] タンクが存在しません`);
        }
        const currentStatus = String((tankSnap.data() as any)?.status ?? "");
        return { item, tag, condition: appData.condition as Condition, note, currentStatus };
      }));

      await applyBulkTankOperations(
        approvedData.map(({ item, tag, note, currentStatus }) => ({
          tankId: item.tankId,
          transitionAction: resolveReturnAction(tag, currentStatus),
          currentStatus,
          staff: staffName,
          location: "倉庫",
          tankNote: note,
          logNote: note,
          logExtra: { customerId: selectedReturnGroup.customerId },
        })),
        (batch) => {
          approvedData.forEach(({ item, condition }) => {
            batch.update(doc(db, "transactions", item.id), {
              status: "completed",
              finalCondition: condition,
              fulfilledAt: serverTimestamp(),
              fulfilledBy: staffName,
            });
          });
        }
      );

      alert(`${approved.length}件の返却を承認しました`);
      setSelectedReturnGroup(null);
      fetchApprovals();
      fetchBulkTanks();
    } catch (e: any) {
      alert("エラー: " + e.message);
    } finally {
      setApprovalSubmitting(false);
    }
  }, [approvals, fetchApprovals, fetchBulkTanks, selectedReturnGroup]);

  return {
    approvalsLoading,
    returnGroups,
    selectedReturnGroup,
    setSelectedReturnGroup,
    approvals,
    setApprovals,
    approvalSubmitting,
    fetchApprovals,
    openReturnGroup,
    fulfillReturns,
  };
}
