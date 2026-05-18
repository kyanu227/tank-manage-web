"use client";

import { useMemo } from "react";
import { ArrowDownToLine, CheckCircle2, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import ReturnTagSelector from "@/components/ReturnTagSelector";
import { RETURN_TAG, STATUS } from "@/lib/tank-rules";
import type { UseBulkReturnByLocationResult } from "../hooks/useBulkReturnByLocation";
import type { BulkReturnDatePool } from "../types";
import type { ReturnSegmentKey, ReturnSegmentStat } from "./ReturnSegmentGestureLauncher";

interface BulkReturnByLocationPanelProps {
  bulk: UseBulkReturnByLocationResult;
  activeSegment?: ReturnSegmentKey | null;
}

const SEGMENT_CONFIG: Record<ReturnSegmentKey, Omit<ReturnSegmentStat, "customerCount" | "tankCount" | "taggedCount">> = {
  normal: {
    key: "normal",
    label: "通常返却",
    shortLabel: "通常",
    color: "#0891b2",
    background: "#ecfeff",
  },
  customer_requests: {
    key: "customer_requests",
    label: "返却タグ処理待ち",
    shortLabel: "タグ待ち",
    color: "#10b981",
    background: "#ecfdf5",
  },
  long_term: {
    key: "long_term",
    label: "長期貸出",
    shortLabel: "長期",
    color: "#be123c",
    background: "#fff1f2",
  },
};

const DATE_POOL_SECTIONS: Array<{
  pool: BulkReturnDatePool;
  segment: Extract<ReturnSegmentKey, "normal" | "long_term">;
  label: string;
  description: string;
  color: string;
  background: string;
  border: string;
}> = [
  {
    pool: "today_lent",
    segment: "normal",
    label: "本日の貸出分",
    description: "JST 0:00〜23:59 の貸出中",
    color: "#0891b2",
    background: "#ecfeff",
    border: "#67e8f9",
  },
  {
    pool: "past_lent",
    segment: "normal",
    label: "前日以前の貸出中",
    description: "今日の通常返却とは別枠",
    color: "#d97706",
    background: "#fffbeb",
    border: "#fcd34d",
  },
  {
    pool: "unknown_lent",
    segment: "normal",
    label: "日付不明",
    description: "updatedAt がない貸出中",
    color: "#64748b",
    background: "#f8fafc",
    border: "#cbd5e1",
  },
  {
    pool: "long_term",
    segment: "long_term",
    label: "長期貸出",
    description: "未返却タンクのみ",
    color: "#be123c",
    background: "#fff1f2",
    border: "#fda4af",
  },
];

function getPoolsForSegment(activeSegment: ReturnSegmentKey | null): BulkReturnDatePool[] {
  if (activeSegment === "long_term") return ["long_term"];
  if (activeSegment === "normal") return ["today_lent", "past_lent", "unknown_lent"];
  return ["today_lent", "past_lent", "unknown_lent", "long_term"];
}

export default function BulkReturnByLocationPanel({
  bulk,
  activeSegment = null,
}: BulkReturnByLocationPanelProps) {
  const {
    bulkLoading,
    groupedTanks,
    groupMeta,
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
        groupKeys: groupKeys.filter((groupKey) => groupMeta[groupKey]?.pool === section.pool),
      }))
      .filter((section) => section.groupKeys.length > 0)
  ), [groupKeys, groupMeta, visiblePoolKeys]);
  const visibleGroupKeys = useMemo(
    () => visibleSections.flatMap((section) => section.groupKeys),
    [visibleSections]
  );

  const activeSegmentStat = activeSegment
    ? SEGMENT_CONFIG[activeSegment]
    : null;
  const totalStat = useMemo<ReturnSegmentStat>(() => {
    const locations = new Set<string>();
    let tankCount = 0;
    let taggedCount = 0;
    visibleGroupKeys.forEach((groupKey) => {
      const meta = groupMeta[groupKey];
      const tanks = groupedTanks[groupKey] ?? [];
      if (meta) locations.add(meta.location);
      tankCount += tanks.length;
      taggedCount += tanks.filter((tank) => tank.tag !== "normal").length;
    });
    return {
      key: "normal",
      label: "全貸出タンク",
      shortLabel: "全体",
      color: "#64748b",
      background: "#f8fafc",
      customerCount: locations.size,
      tankCount,
      taggedCount,
    };
  }, [groupMeta, groupedTanks, visibleGroupKeys]);
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
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
        <h3 style={{ fontSize: 14, fontWeight: 800, color: "#475569", margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 4, height: 16, borderRadius: 2, background: sectionStat.color, display: "inline-block" }} />
          {sectionStat.label}
        </h3>
        <span style={{ fontSize: 11, color: hasSectionItems ? sectionStat.color : "#94a3b8", fontWeight: 900, border: "1px solid #e2e8f0", borderRadius: 999, padding: "3px 8px", background: "#fff" }}>
          {sectionStat.customerCount}顧客 / {sectionStat.tankCount}本
          {sectionStat.taggedCount > 0 ? ` / タグ${sectionStat.taggedCount}本` : ""}
        </span>
      </div>

      {bulkLoading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 40, background: "#fff", border: "1px solid #e8eaed", borderRadius: 16 }}>
          <Loader2 size={20} color="#94a3b8" style={{ animation: "spin 1s linear infinite" }} />
        </div>
      ) : groupKeys.length === 0 ? (
        <div style={{ background: "#fff", border: "1px solid #e8eaed", borderRadius: 16, padding: "24px 16px", textAlign: "center" }}>
          <CheckCircle2 size={24} color="#10b981" style={{ marginBottom: 8 }} />
          <p style={{ fontSize: 13, fontWeight: 600, color: "#94a3b8", margin: 0 }}>貸出中のタンクはありません</p>
        </div>
      ) : visibleGroupKeys.length === 0 ? (
        <div style={{ background: "#fff", border: "1px solid #e8eaed", borderRadius: 16, padding: "24px 16px", textAlign: "center" }}>
          <CheckCircle2 size={24} color="#10b981" style={{ marginBottom: 8 }} />
          <p style={{ fontSize: 13, fontWeight: 600, color: "#64748b", margin: 0 }}>
            この区分の貸出先はありません
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {visibleSections.map((section) => {
            const sectionTankCount = section.groupKeys.reduce((sum, groupKey) => sum + (groupedTanks[groupKey]?.length ?? 0), 0);
            const sectionLocationCount = new Set(section.groupKeys.map((groupKey) => groupMeta[groupKey]?.location).filter(Boolean)).size;

            return (
              <section key={section.pool} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "0 2px" }}>
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
                    {sectionLocationCount}顧客 / {sectionTankCount}本
                  </span>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {section.groupKeys.map((groupKey) => {
                    const meta = groupMeta[groupKey];
                    const loc = meta?.location ?? groupKey;
                    const tanks = groupedTanks[groupKey] ?? [];
                    const isExpanded = expanded[groupKey];
                    const isReturning = returning[groupKey];
                    const hasKeepTag = tanks.some((tank) => tank.tag === RETURN_TAG.KEEP);
                    const taggedPreview = tanks.filter((tank) => tank.tag !== "normal").slice(0, 3);
                    const hiddenTaggedCount = Math.max(0, tanks.filter((tank) => tank.tag !== "normal").length - taggedPreview.length);
                    const statusLabel = meta?.pool === "long_term" ? "長期貸出" : "貸出中";

                    return (
                      <div key={groupKey} style={{ background: "#fff", border: `1.5px solid ${section.pool === "today_lent" ? section.border : "#e8eaed"}`, borderRadius: 16, overflow: "hidden", boxShadow: section.pool === "today_lent" ? `0 8px 22px ${section.color}14` : "none" }}>
                        {/* アコーディオンヘッダー */}
                        <div
                          onClick={() => toggleExpand(groupKey)}
                          style={{
                            padding: "16px 20px", display: "flex", alignItems: "center", justifyContent: "space-between",
                            cursor: "pointer", userSelect: "none", background: isExpanded ? section.background : "#fff",
                            borderBottom: isExpanded ? "1px solid #e8eaed" : "none", transition: "background 0.2s",
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                            <div style={{ padding: 4, background: section.background, borderRadius: 8, color: section.color, flexShrink: 0 }}>
                              {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                            </div>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                                <h3 style={{ fontSize: 16, fontWeight: 800, color: "#0f172a", margin: 0 }}>{loc}</h3>
                                <span style={{ padding: "3px 7px", borderRadius: 999, background: section.background, color: section.color, border: `1px solid ${section.border}`, fontSize: 10, fontWeight: 900 }}>
                                  {meta?.poolLabel ?? section.label}
                                </span>
                                <span style={{ padding: "3px 7px", borderRadius: 999, background: "#f8fafc", color: "#475569", border: "1px solid #e2e8f0", fontSize: 10, fontWeight: 900 }}>
                                  {meta?.dateLabel ?? section.label}
                                </span>
                              </div>
                              <p style={{ fontSize: 13, color: "#64748b", margin: "4px 0 0 0", fontWeight: 600 }}>
                                {tanks.length}本 {statusLabel}
                              </p>
                              {taggedPreview.length > 0 && (
                                <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
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
                                      {tank.id} {tank.tag === "uncharged" ? "未充填" : tank.tag === "keep" ? "持ち越し" : "未使用"}
                                    </span>
                                  ))}
                                  {hiddenTaggedCount > 0 && (
                                    <span style={{ padding: "3px 6px", borderRadius: 999, background: "#f1f5f9", color: "#64748b", fontSize: 10, fontWeight: 900 }}>
                                      +{hiddenTaggedCount}件
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>

                          {/* 一括返却ボタン */}
                          <div onClick={(e) => e.stopPropagation()}>
                            <button
                              onClick={() => handleBulkReturnForGroup(groupKey)}
                              disabled={isReturning}
                              style={{
                                padding: "8px 16px", borderRadius: 10, border: "none",
                                background: isReturning ? "#e2e8f0" : "#0f172a",
                                color: isReturning ? "#94a3b8" : "#fff",
                                fontSize: 13, fontWeight: 700, cursor: isReturning ? "not-allowed" : "pointer",
                                display: "flex", alignItems: "center", gap: 6, transition: "all 0.15s",
                                boxShadow: isReturning ? "none" : "0 2px 4px rgba(0,0,0,0.1)",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {isReturning ? <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} /> : <ArrowDownToLine size={16} />}
                              {hasKeepTag ? "返却/持ち越し" : "一括返却"}
                            </button>
                          </div>
                        </div>

                        {/* アコーディオンボディ */}
                        {isExpanded && (
                          <div style={{ padding: "16px 20px", background: "#fff" }}>
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 12 }}>
                              {tanks.map((tank) => (
                                <div
                                  key={tank.id}
                                  style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", border: "1px solid #f1f5f9", borderRadius: 12, background: "#f8fafc" }}
                                >
                                  <div style={{ display: "flex", flexDirection: "column" }}>
                                    <span style={{ fontSize: 15, fontWeight: 800, fontFamily: "monospace", color: "#1e293b", letterSpacing: "0.05em" }}>
                                      {tank.id}
                                    </span>
                                    <span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600, marginTop: 2 }}>
                                      {tank.staff}
                                    </span>
                                  </div>
                                  {/* タグセレクター */}
                                  <div style={{ width: 220, flexShrink: 0 }}>
                                    <ReturnTagSelector
                                      value={tank.tag}
                                      onChange={(value) => updateTag(groupKey, tank.id, value)}
                                      options={[
                                        { value: RETURN_TAG.UNCHARGED, label: "未充填" },
                                        { value: RETURN_TAG.UNUSED, label: "未使用" },
                                        ...(tank.status === STATUS.LENT
                                          ? [{ value: RETURN_TAG.KEEP, label: "持ち越し" }]
                                          : []),
                                      ]}
                                      compact
                                    />
                                  </div>
                                </div>
                              ))}
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
