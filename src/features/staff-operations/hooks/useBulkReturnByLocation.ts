"use client";

import { useCallback, useMemo, useState } from "react";
import { requireStaffIdentity, useStaffLocale } from "@/hooks/useStaffSession";
import type { Locale } from "@/lib/locale";
import { coerceTankStatusCode } from "@/lib/tank-action-status-codes";
import {
  StaleTankCycleError,
  type StaleTankCycleIssue,
} from "@/lib/tank-operation";
import { RETURN_TAG } from "@/lib/tank-rules";
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
  const staffLocale = useStaffLocale();

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
      await updateBulkReturnTagMarker(tankId, newTag);
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
    const latestReadiness = getBulkReturnGroupReadiness(tanksToReturn);
    if (!latestReadiness.ready) {
      alert(formatMissingCycleAlert(latestReadiness.issues, staffLocale));
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
      const actor = requireStaffIdentity();

      await submitBulkReturnGroup({
        tanks: tanksToReturn,
        fallbackLocation: loc,
        actor,
      });

      const completeMessage = keepCount > 0
        ? `${groupLabel} の処理が完了しました。\n返却: ${returnCount}本 / 持ち越し: ${keepCount}本`
        : `${groupLabel} の一括返却が完了しました。`;
      alert(completeMessage);
      fetchBulkTanks();
    } catch (e: unknown) {
      if (e instanceof StaleTankCycleError) {
        alert(formatStaleCycleAlert(e.issues, staffLocale));
      } else {
        alert(`${BULK_RETURN_ERROR_TEXT.errorPrefix[staffLocale]}${errorMessage(e)}`);
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
