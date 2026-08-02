"use client";

import { useCallback, useState } from "react";
import { requireStaffIdentity } from "@/hooks/useStaffSession";
import { DEFAULT_LOCALE, type Locale } from "@/lib/locale";
import { formatStaffCount } from "@/lib/staff-display";
import {
  getStaffOperationErrorMessage,
  logStaffOperationError,
} from "@/lib/staff-operation-error";
import { confirmPendingReturnRequests } from "@/lib/firebase/return-tag-processing-service";
import {
  transactionsRepository,
  type TransactionDoc,
} from "@/lib/firebase/repositories";
import type {
  PendingReturn,
  ReturnConfirmationSelectionMap,
  ReturnGroup,
  TimestampLike,
} from "../types";
import { getStaffOperationText } from "../i18n";

interface UseReturnTagProcessingParams {
  fetchBulkTanks: () => Promise<void>;
  locale?: Locale;
}

export interface UseReturnTagProcessingResult {
  pendingReturnTagsLoading: boolean;
  pendingReturnTagsLoadFailed: boolean;
  returnGroups: ReturnGroup[];
  selectedReturnGroup: ReturnGroup | null;
  setSelectedReturnGroup: (group: ReturnGroup | null) => void;
  returnTagSelections: ReturnConfirmationSelectionMap;
  setReturnTagSelections: React.Dispatch<React.SetStateAction<ReturnConfirmationSelectionMap>>;
  returnConfirmationSubmitting: boolean;
  fetchPendingReturnTags: () => Promise<void>;
  openReturnTagGroup: (group: ReturnGroup) => void;
  confirmSelectedReturnRequests: () => Promise<void>;
}

export function useReturnTagProcessing({
  fetchBulkTanks,
  locale = DEFAULT_LOCALE,
}: UseReturnTagProcessingParams): UseReturnTagProcessingResult {
  const [pendingReturnTagsLoading, setPendingReturnTagsLoading] = useState(true);
  const [pendingReturnTagsLoadFailed, setPendingReturnTagsLoadFailed] = useState(false);
  const [returnGroups, setReturnGroups] = useState<ReturnGroup[]>([]);
  const [selectedReturnGroup, setSelectedReturnGroup] = useState<ReturnGroup | null>(null);
  const [returnTagSelections, setReturnTagSelections] = useState<ReturnConfirmationSelectionMap>({});
  const [returnConfirmationSubmitting, setReturnConfirmationSubmitting] = useState(false);

  const fetchPendingReturnTags = useCallback(async () => {
    setPendingReturnTagsLoading(true);
    setPendingReturnTagsLoadFailed(false);
    try {
      const docs = await transactionsRepository.getPendingReturnTags();
      const items = docs.map(toPendingReturn);
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
      setPendingReturnTagsLoadFailed(true);
    } finally {
      setPendingReturnTagsLoading(false);
    }
  }, []);

  const openReturnTagGroup = useCallback((group: ReturnGroup) => {
    setSelectedReturnGroup(group);
    const init: ReturnConfirmationSelectionMap = {};
    group.items.forEach((item) => {
      init[item.id] = { selected: false, condition: item.condition };
    });
    setReturnTagSelections(init);
  }, []);

  const confirmSelectedReturnRequests = useCallback(async () => {
    if (!selectedReturnGroup) return;
    const selectedCount = selectedReturnGroup.items.filter((i) => returnTagSelections[i.id]?.selected).length;
    if (selectedCount === 0) {
      alert(getStaffOperationText("selectTanks", locale));
      return;
    }
    setReturnConfirmationSubmitting(true);
    try {
      const actor = requireStaffIdentity();
      const { processedCount } = await confirmPendingReturnRequests({
        group: selectedReturnGroup,
        selections: returnTagSelections,
        actor,
      });

      alert(getStaffOperationText("processedReturnTags", locale, {
        countLabel: formatStaffCount(processedCount, locale, {
          ja: "件", enSingular: "return tag", enPlural: "return tags",
        }),
      }));
      setSelectedReturnGroup(null);
      fetchPendingReturnTags();
      fetchBulkTanks();
    } catch (e: unknown) {
      logStaffOperationError("Return tag processing failed", e);
      const message = getStaffOperationErrorMessage(e, locale, {
        unknownMessage: getStaffOperationText("returnTagFailure", locale),
      });
      alert(locale === "ja" ? `エラー: ${message}` : message);
    } finally {
      setReturnConfirmationSubmitting(false);
    }
  }, [fetchBulkTanks, fetchPendingReturnTags, locale, returnTagSelections, selectedReturnGroup]);

  return {
    pendingReturnTagsLoading,
    pendingReturnTagsLoadFailed,
    returnGroups,
    selectedReturnGroup,
    setSelectedReturnGroup,
    returnTagSelections,
    setReturnTagSelections,
    returnConfirmationSubmitting,
    fetchPendingReturnTags,
    openReturnTagGroup,
    confirmSelectedReturnRequests,
  };
}

function toPendingReturn(transaction: TransactionDoc): PendingReturn {
  const condition = Reflect.get(transaction, "condition");
  if (
    typeof transaction.customerId !== "string"
    || typeof transaction.customerName !== "string"
    || typeof transaction.tankId !== "string"
    || !isStoredReturnCondition(condition)
  ) {
    throw new Error(`Invalid pending return request: ${transaction.id}`);
  }

  return {
    id: transaction.id,
    customerId: transaction.customerId,
    customerName: transaction.customerName,
    tankId: transaction.tankId,
    condition,
    ...(Object.prototype.hasOwnProperty.call(transaction, "expectedLatestLogId")
      ? { expectedLatestLogId: transaction.expectedLatestLogId }
      : {}),
    ...(isTimestampLike(transaction.createdAt)
      ? { createdAt: transaction.createdAt }
      : {}),
  };
}

function isStoredReturnCondition(value: unknown): value is PendingReturn["condition"] {
  return typeof value === "string";
}

function isTimestampLike(value: unknown): value is TimestampLike {
  return typeof value === "object"
    && value !== null
    && "toMillis" in value
    && typeof value.toMillis === "function";
}
