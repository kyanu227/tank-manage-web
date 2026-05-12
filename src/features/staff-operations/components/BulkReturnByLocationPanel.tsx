"use client";

import { useMemo, useState } from "react";
import { ArrowDownToLine, CheckCircle2, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import ReturnTagSelector from "@/components/ReturnTagSelector";
import { STATUS } from "@/lib/tank-rules";
import type { UseBulkReturnByLocationResult } from "../hooks/useBulkReturnByLocation";
import ReturnSegmentGestureLauncher, {
  type ReturnSegmentKey,
  type ReturnSegmentStat,
} from "./ReturnSegmentGestureLauncher";

interface BulkReturnByLocationPanelProps {
  bulk: UseBulkReturnByLocationResult;
}

const SEGMENT_CONFIG: Record<ReturnSegmentKey, Omit<ReturnSegmentStat, "customerCount" | "tankCount" | "taggedCount">> = {
  customer_requests: {
    key: "customer_requests",
    label: "顧客申請あり",
    shortLabel: "申請",
    color: "#dc2626",
    background: "#fef2f2",
  },
  long_term: {
    key: "long_term",
    label: "長期 / 持ち越し確認",
    shortLabel: "長期",
    color: "#d97706",
    background: "#fffbeb",
  },
  normal: {
    key: "normal",
    label: "通常返却",
    shortLabel: "通常",
    color: "#2563eb",
    background: "#eff6ff",
  },
};

export default function BulkReturnByLocationPanel({ bulk }: BulkReturnByLocationPanelProps) {
  const [activeSegment, setActiveSegment] = useState<ReturnSegmentKey | null>(null);
  const {
    bulkLoading,
    groupedTanks,
    expanded,
    returning,
    locationKeys,
    toggleExpand,
    updateTag,
    handleBulkReturnForLocation,
  } = bulk;

  const locationSegments = useMemo(() => {
    const segments: Record<string, ReturnSegmentKey> = {};
    locationKeys.forEach((loc) => {
      const tanks = groupedTanks[loc] ?? [];
      const hasTaggedTank = tanks.some((tank) => tank.tag !== "normal");
      const hasLongTermTank = tanks.some((tank) => tank.status === STATUS.UNRETURNED);
      if (hasTaggedTank) {
        segments[loc] = "customer_requests";
      } else if (hasLongTermTank) {
        segments[loc] = "long_term";
      } else {
        segments[loc] = "normal";
      }
    });
    return segments;
  }, [groupedTanks, locationKeys]);

  const segmentStats = useMemo<ReturnSegmentStat[]>(() => {
    const stats: Record<ReturnSegmentKey, ReturnSegmentStat> = {
      customer_requests: { ...SEGMENT_CONFIG.customer_requests, customerCount: 0, tankCount: 0, taggedCount: 0 },
      long_term: { ...SEGMENT_CONFIG.long_term, customerCount: 0, tankCount: 0, taggedCount: 0 },
      normal: { ...SEGMENT_CONFIG.normal, customerCount: 0, tankCount: 0, taggedCount: 0 },
    };

    locationKeys.forEach((loc) => {
      const segment = locationSegments[loc];
      const tanks = groupedTanks[loc] ?? [];
      if (!segment) return;
      stats[segment].customerCount += 1;
      stats[segment].tankCount += tanks.length;
      stats[segment].taggedCount += tanks.filter((tank) => tank.tag !== "normal").length;
    });

    return [stats.customer_requests, stats.long_term, stats.normal];
  }, [groupedTanks, locationKeys, locationSegments]);

  const filteredLocationKeys = useMemo(
    () => activeSegment
      ? locationKeys.filter((loc) => locationSegments[loc] === activeSegment)
      : locationKeys,
    [activeSegment, locationKeys, locationSegments],
  );

  const activeSegmentStat = activeSegment
    ? segmentStats.find((segment) => segment.key === activeSegment) ?? null
    : null;

  return (
    <div style={{ position: "relative" }}>
      {!bulkLoading && locationKeys.length > 0 && (
        <ReturnSegmentGestureLauncher
          activeSegment={activeSegment}
          segments={segmentStats}
          onSelectSegment={setActiveSegment}
        />
      )}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
        <h3 style={{ fontSize: 14, fontWeight: 800, color: "#475569", margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 4, height: 16, borderRadius: 2, background: activeSegmentStat?.color ?? "#3b82f6", display: "inline-block" }} />
          {activeSegmentStat ? activeSegmentStat.label : "全貸出タンク"}
          <span style={{ fontSize: 10, color: "#94a3b8", fontWeight: 900, border: "1px solid #e2e8f0", borderRadius: 999, padding: "2px 6px" }}>
            UI試作
          </span>
        </h3>
        {activeSegmentStat && (
          <button
            type="button"
            onClick={() => setActiveSegment(null)}
            style={{
              border: "1px solid #e2e8f0",
              background: "#fff",
              color: "#475569",
              borderRadius: 999,
              padding: "6px 10px",
              fontSize: 12,
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            全て表示
          </button>
        )}
      </div>

      {activeSegmentStat && (
        <div style={{ marginBottom: 12, padding: "10px 12px", borderRadius: 14, background: activeSegmentStat.background, color: activeSegmentStat.color, fontSize: 12, fontWeight: 900 }}>
          {activeSegmentStat.customerCount}顧客 / {activeSegmentStat.tankCount}本
          {activeSegmentStat.taggedCount > 0 ? ` / タグ付き${activeSegmentStat.taggedCount}本` : ""}
          <span style={{ marginLeft: 8, color: "#64748b", fontWeight: 700 }}>
            右側の点は長押しで切替
          </span>
        </div>
      )}

      {bulkLoading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 40 }}>
          <Loader2 size={20} color="#94a3b8" style={{ animation: "spin 1s linear infinite" }} />
        </div>
      ) : locationKeys.length === 0 ? (
        <div style={{ background: "#fff", border: "1px solid #e8eaed", borderRadius: 16, padding: "24px 16px", textAlign: "center" }}>
          <CheckCircle2 size={24} color="#10b981" style={{ marginBottom: 8 }} />
          <p style={{ fontSize: 13, fontWeight: 600, color: "#94a3b8", margin: 0 }}>貸出中のタンクはありません</p>
        </div>
      ) : filteredLocationKeys.length === 0 ? (
        <div style={{ background: "#fff", border: "1px solid #e8eaed", borderRadius: 16, padding: "24px 16px", textAlign: "center" }}>
          <CheckCircle2 size={24} color="#10b981" style={{ marginBottom: 8 }} />
          <p style={{ fontSize: 13, fontWeight: 600, color: "#64748b", margin: 0 }}>
            この区分の貸出先はありません
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {filteredLocationKeys.map((loc) => {
            const tanks = groupedTanks[loc];
            const isExpanded = expanded[loc];
            const isReturning = returning[loc];
            const taggedPreview = tanks.filter((tank) => tank.tag !== "normal").slice(0, 3);
            const hiddenTaggedCount = Math.max(0, tanks.filter((tank) => tank.tag !== "normal").length - taggedPreview.length);

            return (
              <div key={loc} style={{ background: "#fff", border: "1px solid #e8eaed", borderRadius: 16, overflow: "hidden" }}>
                {/* アコーディオンヘッダー */}
                <div
                  onClick={() => toggleExpand(loc)}
                  style={{
                    padding: "16px 20px", display: "flex", alignItems: "center", justifyContent: "space-between",
                    cursor: "pointer", userSelect: "none", background: isExpanded ? "#f8fafc" : "#fff",
                    borderBottom: isExpanded ? "1px solid #e8eaed" : "none", transition: "background 0.2s",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{ padding: 4, background: "#e0f2fe", borderRadius: 8, color: "#0284c7" }}>
                      {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                    </div>
                    <div>
                      <h3 style={{ fontSize: 16, fontWeight: 800, color: "#0f172a", margin: 0 }}>{loc}</h3>
                      <p style={{ fontSize: 13, color: "#64748b", margin: "2px 0 0 0", fontWeight: 600 }}>
                        {tanks.length}本 貸出中
                      </p>
                      {taggedPreview.length > 0 && (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
                          {taggedPreview.map((tank) => (
                            <span
                              key={tank.id}
                              style={{
                                padding: "3px 6px",
                                borderRadius: 999,
                                background: tank.tag === "uncharged" ? "#fef2f2" : "#ecfdf5",
                                color: tank.tag === "uncharged" ? "#dc2626" : "#059669",
                                fontSize: 10,
                                fontWeight: 900,
                              }}
                            >
                              {tank.id} {tank.tag === "uncharged" ? "未充填" : "未使用"}
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
                      onClick={() => handleBulkReturnForLocation(loc)}
                      disabled={isReturning}
                      style={{
                        padding: "8px 16px", borderRadius: 10, border: "none",
                        background: isReturning ? "#e2e8f0" : "#0f172a",
                        color: isReturning ? "#94a3b8" : "#fff",
                        fontSize: 13, fontWeight: 700, cursor: isReturning ? "not-allowed" : "pointer",
                        display: "flex", alignItems: "center", gap: 6, transition: "all 0.15s",
                        boxShadow: isReturning ? "none" : "0 2px 4px rgba(0,0,0,0.1)",
                      }}
                    >
                      {isReturning ? <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} /> : <ArrowDownToLine size={16} />}
                      一括返却
                    </button>
                  </div>
                </div>

                {/* アコーディオンボディ */}
                {isExpanded && (
                  <div style={{ padding: "16px 20px", background: "#fff" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
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
                          <div style={{ width: 180, flexShrink: 0 }}>
                            <ReturnTagSelector
                              value={tank.tag}
                              onChange={(value) => updateTag(loc, tank.id, value)}
                              options={[
                                { value: "uncharged", label: "未充填" },
                                { value: "unused", label: "未使用" },
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
      )}
    </div>
  );
}
