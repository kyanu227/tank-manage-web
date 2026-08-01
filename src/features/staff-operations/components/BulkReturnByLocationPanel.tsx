"use client";

import { useId, useMemo } from "react";
import { ArrowDownToLine, CheckCircle2, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import ReturnTagSelector from "@/components/ReturnTagSelector";
import { useStaffLocale } from "@/hooks/useStaffSession";
import type { Locale } from "@/lib/locale";
import { getReturnTagLabel } from "@/lib/return-tag-labels";
import { coerceTankStatusCode } from "@/lib/tank-action-status-codes";
import { RETURN_TAG } from "@/lib/tank-rules";
import {
  formatBulkReturnCustomerTankCount,
  formatBulkReturnHiddenCount,
  formatBulkReturnTaggedTankCount,
  formatBulkReturnTankCountWithStatus,
  getBulkReturnDateLabel,
  getBulkReturnDisplayLocation,
  getBulkReturnPoolLabel,
} from "../bulk-return-display";
import type { BulkReturnCycleReadinessIssue } from "../bulk-return-cycle-readiness";
import type { UseBulkReturnByLocationResult } from "../hooks/useBulkReturnByLocation";
import type { BulkReturnDatePool } from "../types";
import type { ReturnSegmentKey, ReturnSegmentStat } from "./ReturnSegmentGestureLauncher";

interface BulkReturnByLocationPanelProps {
  bulk: UseBulkReturnByLocationResult;
  activeSegment?: ReturnSegmentKey | null;
}

type ReturnSegmentStyle = Pick<ReturnSegmentStat, "key" | "color" | "background">;

const SEGMENT_CONFIG: Record<ReturnSegmentKey, ReturnSegmentStyle> = {
  normal: {
    key: "normal",
    color: "#0891b2",
    background: "#ecfeff",
  },
  customer_requests: {
    key: "customer_requests",
    color: "#10b981",
    background: "#ecfdf5",
  },
  long_term: {
    key: "long_term",
    color: "#be123c",
    background: "#fff1f2",
  },
};

const SEGMENT_LABELS = {
  normal: {
    ja: { label: "通常返却", shortLabel: "通常" },
    en: { label: "Normal returns", shortLabel: "Normal" },
  },
  customer_requests: {
    ja: { label: "返却タグ処理待ち", shortLabel: "タグ待ち" },
    en: { label: "Pending return tags", shortLabel: "Tags" },
  },
  long_term: {
    ja: { label: "長期貸出", shortLabel: "長期" },
    en: { label: "Long-term rentals", shortLabel: "Long-term" },
  },
} satisfies Record<ReturnSegmentKey, Record<Locale, Pick<ReturnSegmentStat, "label" | "shortLabel">>>;

const BULK_RETURN_TEXT = {
  allRentedTanks: {
    ja: "全貸出タンク",
    en: "All rented tanks",
  },
  noRentedTanks: {
    ja: "貸出中のタンクはありません",
    en: "No rented tanks",
  },
  noLocationsInSection: {
    ja: "この区分の貸出先はありません",
    en: "No customers in this section",
  },
  longTermStatus: {
    ja: "長期貸出",
    en: "long-term",
  },
  lentStatus: {
    ja: "貸出中",
    en: "rented",
  },
  cycleWarningSummary: {
    ja: "cycle情報が不足しているタンクが含まれるため、このグループは一括返却できません。",
    en: "This group cannot be returned because some tanks are missing cycle information.",
  },
  cycleUnknownWarning: {
    ja: "cycle情報を確認できません。再読込してください。",
    en: "Cycle information could not be verified. Reload this page.",
  },
  affected: {
    ja: "対象",
    en: "Affected",
  },
  missing: {
    ja: "不足",
    en: "Missing",
  },
  cycleInfoMissing: {
    ja: "cycle情報不足",
    en: "Cycle information missing",
  },
  cycleInfoUnavailable: {
    ja: "cycle情報を確認できません",
    en: "Cycle information unavailable",
  },
  unavailable: {
    ja: "処理不可",
    en: "Unavailable",
  },
  cycleUnavailableTitle: {
    ja: "cycle情報を確認してから再読込してください",
    en: "Reload after verifying the cycle information",
  },
  allShortLabel: {
    ja: "全体",
    en: "All",
  },
  loading: {
    ja: "貸出タンクを読み込み中…",
    en: "Loading rented tanks…",
  },
  loadFailed: {
    ja: "貸出タンクを読み込めませんでした。",
    en: "Could not load rented tanks.",
  },
  retry: {
    ja: "再試行",
    en: "Retry",
  },
  bulkReturn: {
    ja: "一括返却",
    en: "Bulk return",
  },
  returnAndCarryOver: {
    ja: "返却/持ち越し",
    en: "Return / Carry over",
  },
  expandGroup: {
    ja: "詳細を開く",
    en: "Expand details",
  },
  collapseGroup: {
    ja: "詳細を閉じる",
    en: "Collapse details",
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
} satisfies Record<BulkReturnCycleReadinessIssue["field"], Record<Locale, string>>;

const DATE_POOL_SECTIONS: Array<{
  pool: BulkReturnDatePool;
  segment: Extract<ReturnSegmentKey, "normal" | "long_term">;
  color: string;
  background: string;
  border: string;
}> = [
  {
    pool: "today_lent",
    segment: "normal",
    color: "#0891b2",
    background: "#ecfeff",
    border: "#67e8f9",
  },
  {
    pool: "past_lent",
    segment: "normal",
    color: "#d97706",
    background: "#fffbeb",
    border: "#fcd34d",
  },
  {
    pool: "unknown_lent",
    segment: "normal",
    color: "#64748b",
    background: "#f8fafc",
    border: "#cbd5e1",
  },
  {
    pool: "long_term",
    segment: "long_term",
    color: "#be123c",
    background: "#fff1f2",
    border: "#fda4af",
  },
];

const DATE_POOL_LABELS = {
  today_lent: {
    ja: { label: "本日の貸出分", description: "JST 0:00〜23:59 の貸出中" },
    en: {
      label: "Today's rentals",
      description: "Rented from 0:00 to 23:59 JST",
    },
  },
  past_lent: {
    ja: { label: "前日以前の貸出中", description: "今日の通常返却とは別枠" },
    en: {
      label: "Earlier rentals",
      description: "Separate from today's normal returns",
    },
  },
  unknown_lent: {
    ja: { label: "日付不明", description: "updatedAt がない貸出中" },
    en: {
      label: "Unknown date",
      description: "Rented tanks with no recorded rental date",
    },
  },
  long_term: {
    ja: { label: "長期貸出", description: "未返却タンクのみ" },
    en: {
      label: "Long-term rentals",
      description: "Unreturned tanks only",
    },
  },
} satisfies Record<BulkReturnDatePool, Record<Locale, { label: string; description: string }>>;

function getSegmentConfig(
  segment: ReturnSegmentKey,
  locale: Locale,
): Omit<ReturnSegmentStat, "customerCount" | "tankCount" | "taggedCount"> {
  return {
    ...SEGMENT_CONFIG[segment],
    ...SEGMENT_LABELS[segment][locale],
  };
}

function getPoolsForSegment(activeSegment: ReturnSegmentKey | null): BulkReturnDatePool[] {
  if (activeSegment === "long_term") return ["long_term"];
  if (activeSegment === "normal") return ["today_lent", "past_lent", "unknown_lent"];
  return ["today_lent", "past_lent", "unknown_lent", "long_term"];
}

export default function BulkReturnByLocationPanel({
  bulk,
  activeSegment = null,
}: BulkReturnByLocationPanelProps) {
  const staffLocale = useStaffLocale();
  const panelIdPrefix = useId().replace(/:/g, "");
  const {
    bulkLoading,
    bulkLoadFailed,
    groupedTanks,
    groupMeta,
    groupReadiness,
    expanded,
    returning,
    groupKeys,
    toggleExpand,
    updateTag,
    handleBulkReturnForGroup,
  } = bulk;

  const visiblePoolKeys = useMemo(() => getPoolsForSegment(activeSegment), [activeSegment]);
  const visibleSections = useMemo(() => (
    DATE_POOL_SECTIONS
      .filter((section) => visiblePoolKeys.includes(section.pool))
      .map((section) => ({
        ...section,
        ...DATE_POOL_LABELS[section.pool][staffLocale],
        groupKeys: groupKeys.filter((groupKey) => groupMeta[groupKey]?.pool === section.pool),
      }))
      .filter((section) => section.groupKeys.length > 0)
  ), [groupKeys, groupMeta, staffLocale, visiblePoolKeys]);
  const visibleGroupKeys = useMemo(
    () => visibleSections.flatMap((section) => section.groupKeys),
    [visibleSections]
  );

  const activeSegmentStat = activeSegment
    ? getSegmentConfig(activeSegment, staffLocale)
    : null;
  const totalStat = useMemo<ReturnSegmentStat>(() => {
    const customerGroups = new Set<string>();
    let tankCount = 0;
    let taggedCount = 0;
    visibleGroupKeys.forEach((groupKey) => {
      const meta = groupMeta[groupKey];
      const tanks = groupedTanks[groupKey] ?? [];
      if (meta) customerGroups.add(meta.key);
      tankCount += tanks.length;
      taggedCount += tanks.filter((tank) => tank.tag !== "normal").length;
    });
    return {
      key: "normal",
      label: BULK_RETURN_TEXT.allRentedTanks[staffLocale],
      shortLabel: BULK_RETURN_TEXT.allShortLabel[staffLocale],
      color: "#64748b",
      background: "#f8fafc",
      customerCount: customerGroups.size,
      tankCount,
      taggedCount,
    };
  }, [groupMeta, groupedTanks, staffLocale, visibleGroupKeys]);
  const sectionStat: Omit<ReturnSegmentStat, "customerCount" | "tankCount" | "taggedCount"> & Pick<ReturnSegmentStat, "customerCount" | "tankCount" | "taggedCount"> = activeSegmentStat
    ? {
      ...activeSegmentStat,
      customerCount: totalStat.customerCount,
      tankCount: totalStat.tankCount,
      taggedCount: totalStat.taggedCount,
    }
    : totalStat;
  const hasSectionItems = sectionStat.customerCount > 0 || sectionStat.tankCount > 0;

  return (
    <div style={{ position: "relative", marginBottom: 24 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 12 }}>
        <h3 style={{ fontSize: 14, fontWeight: 800, color: "#475569", margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 4, height: 16, borderRadius: 2, background: sectionStat.color, display: "inline-block" }} />
          {sectionStat.label}
        </h3>
        <span style={{ fontSize: 11, color: hasSectionItems ? sectionStat.color : "#94a3b8", fontWeight: 900, border: "1px solid #e2e8f0", borderRadius: 999, padding: "3px 8px", background: "#fff" }}>
          {formatBulkReturnCustomerTankCount(sectionStat.customerCount, sectionStat.tankCount, staffLocale)}
          {sectionStat.taggedCount > 0 ? ` / ${formatBulkReturnTaggedTankCount(sectionStat.taggedCount, staffLocale)}` : ""}
        </span>
      </div>

      {bulkLoading ? (
        <div
          role="status"
          aria-live="polite"
          style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: 40, background: "#fff", border: "1px solid #e8eaed", borderRadius: 16, color: "#64748b", fontSize: 13, fontWeight: 700 }}
        >
          <Loader2 aria-hidden="true" size={20} color="#94a3b8" style={{ animation: "spin 1s linear infinite" }} />
          <span>{BULK_RETURN_TEXT.loading[staffLocale]}</span>
        </div>
      ) : bulkLoadFailed ? (
        <div
          role="alert"
          style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: "24px 16px", background: "#fff", border: "1px solid #fecaca", borderRadius: 16, textAlign: "center" }}
        >
          <p style={{ fontSize: 13, fontWeight: 700, color: "#991b1b", margin: 0 }}>
            {BULK_RETURN_TEXT.loadFailed[staffLocale]}
          </p>
          <button
            type="button"
            onClick={() => void bulk.fetchBulkTanks()}
            style={{ padding: "8px 16px", borderRadius: 10, border: "1px solid #fecaca", background: "#fff", color: "#b91c1c", fontSize: 13, fontWeight: 800, cursor: "pointer" }}
          >
            {BULK_RETURN_TEXT.retry[staffLocale]}
          </button>
        </div>
      ) : groupKeys.length === 0 ? (
        <div style={{ background: "#fff", border: "1px solid #e8eaed", borderRadius: 16, padding: "24px 16px", textAlign: "center" }}>
          <CheckCircle2 size={24} color="#10b981" style={{ marginBottom: 8 }} />
          <p style={{ fontSize: 13, fontWeight: 600, color: "#94a3b8", margin: 0 }}>{BULK_RETURN_TEXT.noRentedTanks[staffLocale]}</p>
        </div>
      ) : visibleGroupKeys.length === 0 ? (
        <div style={{ background: "#fff", border: "1px solid #e8eaed", borderRadius: 16, padding: "24px 16px", textAlign: "center" }}>
          <CheckCircle2 size={24} color="#10b981" style={{ marginBottom: 8 }} />
          <p style={{ fontSize: 13, fontWeight: 600, color: "#64748b", margin: 0 }}>
            {BULK_RETURN_TEXT.noLocationsInSection[staffLocale]}
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {visibleSections.map((section, sectionIndex) => {
            const sectionTankCount = section.groupKeys.reduce((sum, groupKey) => sum + (groupedTanks[groupKey]?.length ?? 0), 0);
            const sectionLocationCount = new Set(section.groupKeys.map((groupKey) => groupMeta[groupKey]?.key).filter(Boolean)).size;

            return (
              <section key={section.pool} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12, padding: "0 2px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                    <span style={{ width: 7, height: 22, borderRadius: 999, background: section.color, display: "inline-block", boxShadow: section.pool === "today_lent" ? `0 0 0 4px ${section.color}18` : "none" }} />
                    <div style={{ minWidth: 0 }}>
                      <h4 style={{ margin: 0, fontSize: section.pool === "today_lent" ? 16 : 14, lineHeight: 1.25, fontWeight: 900, color: section.color }}>
                        {section.label}
                      </h4>
                      <p style={{ margin: "2px 0 0", fontSize: 11, lineHeight: 1.3, fontWeight: 700, color: "#64748b" }}>
                        {section.description}
                      </p>
                    </div>
                  </div>
                  <span style={{ flexShrink: 0, fontSize: 11, color: section.color, fontWeight: 900, border: `1px solid ${section.border}`, borderRadius: 999, padding: "4px 8px", background: section.background }}>
                    {formatBulkReturnCustomerTankCount(sectionLocationCount, sectionTankCount, staffLocale)}
                  </span>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {section.groupKeys.map((groupKey, groupIndex) => {
                    const meta = groupMeta[groupKey];
                    const loc = meta?.location ?? groupKey;
                    const tanks = groupedTanks[groupKey] ?? [];
                    const displayLocation = getBulkReturnDisplayLocation(
                      loc,
                      meta,
                      staffLocale,
                      tanks,
                    );
                    const poolLabel = meta
                      ? getBulkReturnPoolLabel(meta, staffLocale)
                      : section.label;
                    const dateLabel = meta
                      ? getBulkReturnDateLabel(meta, staffLocale)
                      : section.label;
                    const isExpanded = expanded[groupKey];
                    const isReturning = returning[groupKey];
                    const readiness = groupReadiness[groupKey];
                    const isCycleReady = readiness?.ready === true;
                    const isSubmitDisabled = Boolean(isReturning) || !isCycleReady;
                    const cycleWarningId = `${panelIdPrefix}-bulk-cycle-warning-${sectionIndex}-${groupIndex}`;
                    const groupBodyId = `${panelIdPrefix}-bulk-group-body-${sectionIndex}-${groupIndex}`;
                    const groupedCycleIssues = groupCycleIssuesByTank(readiness?.issues ?? []);
                    const hasKeepTag = tanks.some((tank) => tank.tag === RETURN_TAG.KEEP);
                    const taggedPreview = tanks.filter((tank) => tank.tag !== "normal").slice(0, 3);
                    const hiddenTaggedCount = Math.max(0, tanks.filter((tank) => tank.tag !== "normal").length - taggedPreview.length);
                    const statusLabel = meta?.pool === "long_term" ? BULK_RETURN_TEXT.longTermStatus[staffLocale] : BULK_RETURN_TEXT.lentStatus[staffLocale];

                    return (
                      <div key={groupKey} style={{ background: "#fff", border: `1.5px solid ${section.pool === "today_lent" ? section.border : "#e8eaed"}`, borderRadius: 16, overflow: "hidden", boxShadow: section.pool === "today_lent" ? `0 8px 22px ${section.color}14` : "none" }}>
                        <div
                          style={{
                            padding: "16px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12,
                            userSelect: "none", background: isExpanded ? section.background : "#fff",
                            borderBottom: isExpanded ? "1px solid #e8eaed" : "none", transition: "background 0.2s",
                          }}
                        >
                          <button
                            type="button"
                            onClick={() => toggleExpand(groupKey)}
                            aria-expanded={Boolean(isExpanded)}
                            aria-controls={groupBodyId}
                            title={isExpanded
                              ? BULK_RETURN_TEXT.collapseGroup[staffLocale]
                              : BULK_RETURN_TEXT.expandGroup[staffLocale]}
                            style={{ appearance: "none", flex: "1 1 220px", minWidth: 0, padding: 0, border: "none", background: "transparent", color: "inherit", display: "flex", alignItems: "center", gap: 12, textAlign: "left", cursor: "pointer" }}
                          >
                            <span aria-hidden="true" style={{ padding: 4, background: section.background, borderRadius: 8, color: section.color, flexShrink: 0, display: "inline-flex" }}>
                              {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                            </span>
                            <span style={{ minWidth: 0 }}>
                              <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                                <span style={{ maxWidth: "100%", minWidth: 0, fontSize: 16, fontWeight: 800, color: "#0f172a", overflowWrap: "anywhere", wordBreak: "break-word" }}>
                                  {displayLocation}
                                </span>
                                <span style={{ padding: "3px 7px", borderRadius: 999, background: section.background, color: section.color, border: `1px solid ${section.border}`, fontSize: 10, fontWeight: 900 }}>
                                  {poolLabel}
                                </span>
                                <span style={{ padding: "3px 7px", borderRadius: 999, background: "#f8fafc", color: "#475569", border: "1px solid #e2e8f0", fontSize: 10, fontWeight: 900 }}>
                                  {dateLabel}
                                </span>
                              </span>
                              <span style={{ display: "block", fontSize: 13, color: "#64748b", marginTop: 4, fontWeight: 600 }}>
                                {formatBulkReturnTankCountWithStatus(tanks.length, statusLabel, staffLocale)}
                              </span>
                              {taggedPreview.length > 0 && (
                                <span style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
                                  {taggedPreview.map((tank) => (
                                    <span
                                      key={tank.id}
                                      style={{
                                        padding: "3px 6px",
                                        borderRadius: 999,
                                        background: tank.tag === "uncharged" ? "#fef2f2" : tank.tag === "keep" ? "#fffbeb" : "#ecfdf5",
                                        color: tank.tag === "uncharged" ? "#dc2626" : tank.tag === "keep" ? "#d97706" : "#059669",
                                        fontSize: 10,
                                        fontWeight: 900,
                                      }}
                                    >
                                      {tank.id} {getReturnTagLabel(tank.tag, staffLocale)}
                                    </span>
                                  ))}
                                  {hiddenTaggedCount > 0 && (
                                    <span style={{ padding: "3px 6px", borderRadius: 999, background: "#f1f5f9", color: "#64748b", fontSize: 10, fontWeight: 900 }}>
                                      {formatBulkReturnHiddenCount(hiddenTaggedCount, staffLocale)}
                                    </span>
                                  )}
                                </span>
                              )}
                            </span>
                          </button>

                          <button
                            type="button"
                            onClick={() => handleBulkReturnForGroup(groupKey)}
                            disabled={isSubmitDisabled}
                            aria-busy={Boolean(isReturning)}
                            aria-describedby={!isCycleReady ? cycleWarningId : undefined}
                            title={!isCycleReady ? BULK_RETURN_TEXT.cycleUnavailableTitle[staffLocale] : undefined}
                            style={{
                              marginLeft: "auto", padding: "8px 16px", borderRadius: 10, border: "none",
                              background: isSubmitDisabled ? "#e2e8f0" : "#0f172a",
                              color: isSubmitDisabled ? "#94a3b8" : "#fff",
                              fontSize: 13, fontWeight: 700, cursor: isSubmitDisabled ? "not-allowed" : "pointer",
                              display: "flex", alignItems: "center", gap: 6, transition: "all 0.15s",
                              boxShadow: isSubmitDisabled ? "none" : "0 2px 4px rgba(0,0,0,0.1)",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {isReturning
                              ? <Loader2 aria-hidden="true" size={16} style={{ animation: "spin 1s linear infinite" }} />
                              : <ArrowDownToLine aria-hidden="true" size={16} />}
                            {hasKeepTag
                              ? BULK_RETURN_TEXT.returnAndCarryOver[staffLocale]
                              : BULK_RETURN_TEXT.bulkReturn[staffLocale]}
                          </button>
                        </div>

                        {!isCycleReady && (
                          <div
                            id={cycleWarningId}
                            role="alert"
                            style={{
                              width: "100%",
                              boxSizing: "border-box",
                              minWidth: 0,
                              padding: "12px 20px",
                              borderTop: "1px solid #fecaca",
                              borderBottom: isExpanded ? "1px solid #fecaca" : "none",
                              background: "#fef2f2",
                              color: "#991b1b",
                              fontSize: 12,
                              lineHeight: 1.55,
                              whiteSpace: "normal",
                              overflowWrap: "anywhere",
                            }}
                          >
                            <div style={{ fontWeight: 800 }}>
                              {readiness
                                ? BULK_RETURN_TEXT.cycleWarningSummary[staffLocale]
                                : BULK_RETURN_TEXT.cycleUnknownWarning[staffLocale]}
                            </div>
                            {readiness && (
                              <div style={{ marginTop: 6 }}>
                                <div>
                                  <strong>{BULK_RETURN_TEXT.affected[staffLocale]}:</strong>{" "}
                                  {groupedCycleIssues
                                    .map(({ tankId }) => tankId)
                                    .join(staffLocale === "ja" ? "、" : ", ")}
                                </div>
                                <div style={{ marginTop: 2 }}>
                                  <strong>{BULK_RETURN_TEXT.missing[staffLocale]}:</strong>
                                </div>
                                <ul style={{ margin: "2px 0 0", paddingLeft: 20 }}>
                                  {groupedCycleIssues.map(({ tankId, fields }) => (
                                    <li key={tankId}>
                                      {tankId}: {fields
                                        .map((field) => CYCLE_FIELD_LABELS[field][staffLocale])
                                        .join(staffLocale === "ja" ? "、" : ", ")}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>
                        )}

                        {isExpanded && (
                          <div id={groupBodyId} style={{ padding: "16px 20px", background: "#fff" }}>
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 320px), 1fr))", gap: 12 }}>
                              {tanks.map((tank) => {
                                const tankCycleIssues = readiness?.issues.filter(
                                  (issue) => issue.tankId === tank.id,
                                ) ?? [];
                                const isTankCycleUnavailable = readiness === undefined
                                  || tankCycleIssues.length > 0;

                                return (
                                  <div
                                    key={tank.id}
                                    style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, minWidth: 0, padding: "10px 14px", border: "1px solid #f1f5f9", borderRadius: 12, background: "#f8fafc" }}
                                  >
                                    <div style={{ display: "flex", flexDirection: "column", maxWidth: "100%", minWidth: 0 }}>
                                      <span style={{ maxWidth: "100%", fontSize: 15, fontWeight: 800, fontFamily: "monospace", color: "#1e293b", letterSpacing: "0.05em", overflowWrap: "anywhere" }}>
                                        {tank.id}
                                      </span>
                                      <span style={{ maxWidth: "100%", fontSize: 11, color: "#94a3b8", fontWeight: 600, marginTop: 2, overflowWrap: "anywhere" }}>
                                        {tank.staff}
                                      </span>
                                    </div>
                                    <div style={{ width: 220, maxWidth: "100%", minWidth: 0, flexShrink: 1, marginLeft: "auto" }}>
                                      {isTankCycleUnavailable ? (
                                        <div
                                          style={{
                                            display: "flex",
                                            flexDirection: "column",
                                            gap: 2,
                                            padding: "7px 10px",
                                            border: "1px solid #fecaca",
                                            borderRadius: 8,
                                            background: "#fef2f2",
                                            color: "#991b1b",
                                            whiteSpace: "normal",
                                            overflowWrap: "anywhere",
                                          }}
                                        >
                                          <strong style={{ fontSize: 11 }}>
                                            {readiness
                                              ? BULK_RETURN_TEXT.cycleInfoMissing[staffLocale]
                                              : BULK_RETURN_TEXT.cycleInfoUnavailable[staffLocale]}
                                          </strong>
                                          <span style={{ fontSize: 11, fontWeight: 800 }}>
                                            {BULK_RETURN_TEXT.unavailable[staffLocale]}
                                          </span>
                                          {tankCycleIssues.length > 0 && (
                                            <span style={{ fontSize: 10 }}>
                                              {BULK_RETURN_TEXT.missing[staffLocale]}:{" "}
                                              {tankCycleIssues
                                                .map((issue) => CYCLE_FIELD_LABELS[issue.field][staffLocale])
                                                .join(staffLocale === "ja" ? "、" : ", ")}
                                            </span>
                                          )}
                                        </div>
                                      ) : (
                                        <ReturnTagSelector
                                          value={tank.tag}
                                          onChange={(value) => updateTag(groupKey, tank.id, value)}
                                          options={[
                                            { value: RETURN_TAG.UNCHARGED, label: getReturnTagLabel(RETURN_TAG.UNCHARGED, staffLocale) },
                                            { value: RETURN_TAG.UNUSED, label: getReturnTagLabel(RETURN_TAG.UNUSED, staffLocale) },
                                            ...(coerceTankStatusCode(tank.status) === "lent"
                                              ? [{ value: RETURN_TAG.KEEP, label: getReturnTagLabel(RETURN_TAG.KEEP, staffLocale) }]
                                              : []),
                                          ]}
                                          locale={staffLocale}
                                          compact
                                          stackedLabels
                                        />
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function groupCycleIssuesByTank(
  issues: readonly BulkReturnCycleReadinessIssue[],
): Array<{
  tankId: string;
  fields: BulkReturnCycleReadinessIssue["field"][];
}> {
  const fieldsByTank = new Map<
    string,
    BulkReturnCycleReadinessIssue["field"][]
  >();
  issues.forEach((issue) => {
    const fields = fieldsByTank.get(issue.tankId) ?? [];
    fields.push(issue.field);
    fieldsByTank.set(issue.tankId, fields);
  });
  return [...fieldsByTank].map(([tankId, fields]) => ({ tankId, fields }));
}
