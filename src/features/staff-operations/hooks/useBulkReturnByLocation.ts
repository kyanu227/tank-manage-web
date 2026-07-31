"use client";

import { useCallback, useMemo, useState } from "react";
import { requireStaffIdentity, useStaffLocale } from "@/hooks/useStaffSession";
import type { Locale } from "@/lib/locale";
import {
  formatStaffTankCount,
  getStaffGenericErrorMessage,
} from "@/lib/staff-display";
import { coerceTankStatusCode } from "@/lib/tank-action-status-codes";
import {
  StaleTankCycleError,
  type StaleTankCycleIssue,
} from "@/lib/tank-operation";
import { RETURN_TAG } from "@/lib/tank-rules";
import { getBulkReturnGroupDisplayLabel } from "../bulk-return-display";
import {
  getBulkReturnGroupReadiness,
  type BulkReturnCycleReadinessIssue,
  type BulkReturnGroupReadiness,
} from "../bulk-return-cycle-readiness";
import {
  fetchBulkReturnCandidates,
  getBulkReturnGroupKeys,
  type BulkTankWithTag,
} from "../queries/bulk-return-candidates";
import {
  submitBulkReturnGroup,
  updateBulkReturnTagMarker,
} from "../services/bulk-return-workflow";
import type { BulkReturnGroupMeta, BulkTagType } from "../types";

export interface UseBulkReturnByLocationResult {
  bulkLoading: boolean;
  bulkLoadFailed: boolean;
  groupedTanks: Record<string, BulkTankWithTag[]>;
  groupMeta: Record<string, BulkReturnGroupMeta>;
  groupReadiness: Record<string, BulkReturnGroupReadiness>;
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
  const [bulkLoadFailed, setBulkLoadFailed] = useState(false);
  const staffLocale = useStaffLocale();

  const fetchBulkTanks = useCallback(async () => {
    setBulkLoading(true);
    setBulkLoadFailed(false);
    try {
      const result = await fetchBulkReturnCandidates();
      setGroupedTanks(result.groupedTanks);
      setGroupMeta(result.groupMeta);
      const newExpanded: Record<string, boolean> = {};
      Object.keys(result.groupedTanks).forEach(groupKey => newExpanded[groupKey] = true);
      setExpanded(newExpanded);
    } catch (e) {
      console.error(e);
      setBulkLoadFailed(true);
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
      alert(BULK_RETURN_ERROR_TEXT.keepSelectionRentedOnly[staffLocale]);
      return;
    }
    setGroupedTanks(prev => {
      const g = { ...prev };
      g[groupKey] = g[groupKey].map(t => (t.id === tankId ? { ...t, tag: newTag } : t));
      return g;
    });
    try {
      await updateBulkReturnTagMarker(tankId, newTag);
    } catch (e) {
      console.error("Failed to update tag", e);
      fetchBulkTanks();
    }
  }, [fetchBulkTanks, groupedTanks, staffLocale]);

  const handleBulkReturnForGroup = useCallback(async (groupKey: string) => {
    const tanksToReturn = groupedTanks[groupKey];
    if (!tanksToReturn || tanksToReturn.length === 0) return;
    const meta = groupMeta[groupKey];
    const loc = meta?.location ?? tanksToReturn[0]?.customerName ?? tanksToReturn[0]?.location ?? "不明";
    const fallbackLocation = loc;
    const groupLabel = getBulkReturnGroupDisplayLabel(
      fallbackLocation,
      meta,
      staffLocale,
      tanksToReturn,
    );
    const invalidKeepTanks = tanksToReturn.filter((tank) => tank.tag === RETURN_TAG.KEEP && coerceTankStatusCode(tank.status) !== "lent");
    if (invalidKeepTanks.length > 0) {
      alert(BULK_RETURN_ERROR_TEXT.keepProcessingRentedOnly[staffLocale]);
      return;
    }
    const latestReadiness = getBulkReturnGroupReadiness(tanksToReturn);
    if (!latestReadiness.ready) {
      alert(formatMissingCycleAlert(latestReadiness.issues, staffLocale));
      return;
    }
    const keepCount = tanksToReturn.filter((tank) => tank.tag === RETURN_TAG.KEEP).length;
    const returnCount = tanksToReturn.length - keepCount;
    const confirmMessage = formatBulkReturnConfirmMessage({
      groupLabel,
      totalCount: tanksToReturn.length,
      returnCount,
      keepCount,
      locale: staffLocale,
    });
    if (!confirm(confirmMessage)) return;

    setReturning(prev => ({ ...prev, [groupKey]: true }));
    try {
      const actor = requireStaffIdentity();

      await submitBulkReturnGroup({
        tanks: tanksToReturn,
        fallbackLocation,
        actor,
      });

      const completeMessage = formatBulkReturnCompleteMessage({
        groupLabel,
        returnCount,
        keepCount,
        locale: staffLocale,
      });
      alert(completeMessage);
      fetchBulkTanks();
    } catch (e: unknown) {
      if (e instanceof StaleTankCycleError) {
        alert(formatStaleCycleAlert(e.issues, staffLocale));
      } else {
        console.error("Bulk return failed", e);
        alert(staffLocale === "ja"
          ? `${BULK_RETURN_ERROR_TEXT.errorPrefix[staffLocale]}${errorMessage(e)}`
          : getStaffGenericErrorMessage(staffLocale));
      }
    } finally {
      setReturning(prev => ({ ...prev, [groupKey]: false }));
    }
  }, [fetchBulkTanks, groupMeta, groupedTanks, staffLocale]);

  const groupKeys = useMemo(
    () => getBulkReturnGroupKeys(groupedTanks, groupMeta),
    [groupMeta, groupedTanks]
  );
  const groupReadiness = useMemo(() => {
    const readinessByGroup: Record<string, BulkReturnGroupReadiness> = {};
    Object.entries(groupedTanks).forEach(([groupKey, tanks]) => {
      readinessByGroup[groupKey] = getBulkReturnGroupReadiness(tanks);
    });
    return readinessByGroup;
  }, [groupedTanks]);

  return {
    bulkLoading,
    bulkLoadFailed,
    groupedTanks,
    groupMeta,
    groupReadiness,
    expanded,
    returning,
    groupKeys,
    fetchBulkTanks,
    toggleExpand,
    updateTag,
    handleBulkReturnForGroup,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const BULK_RETURN_ERROR_TEXT = {
  errorPrefix: {
    ja: "エラー: ",
    en: "Error: ",
  },
  keepSelectionRentedOnly: {
    ja: "持ち越しは貸出中のタンクのみ選択できます。",
    en: "Carry over can only be selected for rented tanks.",
  },
  keepProcessingRentedOnly: {
    ja: "持ち越しは貸出中のタンクのみ処理できます。未返却タンクの持ち越しを外してください。",
    en: "Carry over can only be processed for rented tanks. Remove carry over from unreturned tanks.",
  },
  processQuestion: {
    ja: "のタンクを処理しますか？",
    en: "Process the tanks for",
  },
  returnLabel: {
    ja: "返却",
    en: "Return",
  },
  carryOverLabel: {
    ja: "持ち越し",
    en: "Carry over",
  },
  allTanks: {
    ja: "のタンク全",
    en: "Bulk return all",
  },
  bulkQuestion: {
    ja: "本を一括返却しますか？",
    en: "for",
  },
  tagProcessingHint: {
    ja: "(タグ付けに応じて処理されます)",
    en: "(Tanks will be processed according to their return tags.)",
  },
  processingComplete: {
    ja: "の処理が完了しました。",
    en: "Finished processing the tanks for",
  },
  bulkComplete: {
    ja: "の一括返却が完了しました。",
    en: "Bulk return is complete for",
  },
  missingCycleSummary: {
    ja: "cycle情報が不足しているタンクが含まれるため、このグループは一括返却できません。",
    en: "This group cannot be returned because some tanks are missing cycle information.",
  },
  staleCycleSummary: {
    ja: "タンクのcycle情報が操作候補の作成後に変更されています。",
    en: "Tank cycle information changed after the return candidates were prepared.",
  },
  affected: {
    ja: "対象",
    en: "Affected",
  },
  missing: {
    ja: "不足",
    en: "Missing",
  },
  details: {
    ja: "内容",
    en: "Details",
  },
  reload: {
    ja: "再読込して再確認してください。",
    en: "Reload and review the group before trying again.",
  },
} satisfies Record<string, Record<Locale, string>>;

type BulkReturnMessageCounts = Readonly<{
  groupLabel: string;
  returnCount: number;
  keepCount: number;
  locale: Locale;
}>;

function formatReturnAndCarryOverCounts(
  returnCount: number,
  keepCount: number,
  locale: Locale,
): string {
  return [
    `${BULK_RETURN_ERROR_TEXT.returnLabel[locale]}: ${formatStaffTankCount(returnCount, locale)}`,
    `${BULK_RETURN_ERROR_TEXT.carryOverLabel[locale]}: ${formatStaffTankCount(keepCount, locale)}`,
  ].join(" / ");
}

function formatBulkReturnConfirmMessage({
  groupLabel,
  totalCount,
  returnCount,
  keepCount,
  locale,
}: BulkReturnMessageCounts & Readonly<{ totalCount: number }>): string {
  if (keepCount > 0) {
    const question = locale === "ja"
      ? `${groupLabel} ${BULK_RETURN_ERROR_TEXT.processQuestion[locale]}`
      : `${BULK_RETURN_ERROR_TEXT.processQuestion[locale]} ${groupLabel}?`;
    return `${question}\n${formatReturnAndCarryOverCounts(returnCount, keepCount, locale)}`;
  }

  const question = locale === "ja"
    ? `${groupLabel} ${BULK_RETURN_ERROR_TEXT.allTanks[locale]} ${totalCount} ${BULK_RETURN_ERROR_TEXT.bulkQuestion[locale]}`
    : `${BULK_RETURN_ERROR_TEXT.allTanks[locale]} ${formatStaffTankCount(totalCount, locale)} ${BULK_RETURN_ERROR_TEXT.bulkQuestion[locale]} ${groupLabel}?`;
  return `${question}\n${BULK_RETURN_ERROR_TEXT.tagProcessingHint[locale]}`;
}

function formatBulkReturnCompleteMessage({
  groupLabel,
  returnCount,
  keepCount,
  locale,
}: BulkReturnMessageCounts): string {
  if (keepCount > 0) {
    const summary = locale === "ja"
      ? `${groupLabel} ${BULK_RETURN_ERROR_TEXT.processingComplete[locale]}`
      : `${BULK_RETURN_ERROR_TEXT.processingComplete[locale]} ${groupLabel}.`;
    return `${summary}\n${formatReturnAndCarryOverCounts(returnCount, keepCount, locale)}`;
  }
  return locale === "ja"
    ? `${groupLabel} ${BULK_RETURN_ERROR_TEXT.bulkComplete[locale]}`
    : `${BULK_RETURN_ERROR_TEXT.bulkComplete[locale]} ${groupLabel}.`;
}

const CYCLE_FIELD_LABELS = {
  customerId: {
    ja: "顧客ID",
    en: "customer ID",
  },
  latestLogId: {
    ja: "最新操作ID",
    en: "latest operation ID",
  },
} satisfies Record<StaleTankCycleIssue["field"], Record<Locale, string>>;

const CYCLE_REASON_LABELS = {
  missing_current: {
    ja: "現在のcycle情報が不足",
    en: "current cycle value is missing",
  },
  missing_expected: {
    ja: "操作候補のcycle情報が不足",
    en: "return candidate value is missing",
  },
  mismatch: {
    ja: "現在値と操作候補が不一致",
    en: "current and candidate values differ",
  },
} satisfies Record<StaleTankCycleIssue["reason"], Record<Locale, string>>;

function formatMissingCycleAlert(
  issues: readonly BulkReturnCycleReadinessIssue[],
  locale: Locale,
): string {
  const affectedTankIds = [...new Set(issues.map((issue) => issue.tankId))];
  const details = groupIssueLabelsByTank(
    issues.map((issue) => ({
      tankId: issue.tankId,
      label: CYCLE_FIELD_LABELS[issue.field][locale],
    })),
    locale,
  );
  return [
    BULK_RETURN_ERROR_TEXT.missingCycleSummary[locale],
    "",
    `${BULK_RETURN_ERROR_TEXT.affected[locale]}: ${affectedTankIds.join(locale === "ja" ? "、" : ", ")}`,
    `${BULK_RETURN_ERROR_TEXT.missing[locale]}:`,
    ...details,
    "",
    BULK_RETURN_ERROR_TEXT.reload[locale],
  ].join("\n");
}

function formatStaleCycleAlert(
  issues: readonly StaleTankCycleIssue[],
  locale: Locale,
): string {
  const details = groupIssueLabelsByTank(
    issues.map((issue) => ({
      tankId: issue.tankId,
      label: `${CYCLE_FIELD_LABELS[issue.field][locale]} (${CYCLE_REASON_LABELS[issue.reason][locale]})`,
    })),
    locale,
  );
  return [
    BULK_RETURN_ERROR_TEXT.staleCycleSummary[locale],
    "",
    `${BULK_RETURN_ERROR_TEXT.details[locale]}:`,
    ...details,
    "",
    BULK_RETURN_ERROR_TEXT.reload[locale],
  ].join("\n");
}

function groupIssueLabelsByTank(
  issues: readonly Readonly<{ tankId: string; label: string }>[],
  locale: Locale,
): string[] {
  const labelsByTank = new Map<string, string[]>();
  issues.forEach((issue) => {
    const labels = labelsByTank.get(issue.tankId) ?? [];
    labels.push(issue.label);
    labelsByTank.set(issue.tankId, labels);
  });
  return [...labelsByTank].map(
    ([tankId, labels]) => `${tankId}: ${labels.join(locale === "ja" ? "、" : ", ")}`,
  );
}
